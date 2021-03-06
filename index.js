'use strict';

var crypto = require('crypto');

/**
 * Exported function
 *
 * Options:
 *
 *  - `algorithm` hash algo to be used by this instance: *'sha1', 'md5' 
 *  - `excludeValues` {true|*false} hash object keys, values ignored 
 *  - `encoding` hash encoding, supports 'buffer', '*hex', 'binary', 'base64' 
 *  - `ignoreUnknown` {true|*false} ignore unknown object types
 *  - `replacer` optional function that replaces values before hashing
 *  - `respectFunctionProperties` {*true|false} consider function properties when hashing
 *  - `respectType` {*true|false} Respect special properties (prototype, constructor)
 *    when hashing to distinguish between types
 *  - `unorderedArrays` {true|*false} Sort all arrays before hashing
 *  - `unorderedSets` {*true|false} Sort `Set` and `Map` instances before hashing
 *  * = default
 *
 * @param {object} object value to hash
 * @param {object} options hashing options
 * @return {string} hash value
 * @api public
 */
exports = module.exports = objectHash;

function objectHash(object, options){
  options = applyDefaults(object, options);

  return hash(object, options);
}

/**
 * Exported sugar methods
 *
 * @param {object} object value to hash
 * @return {string} hash value
 * @api public
 */
exports.sha1 = function(object){
  return objectHash(object);
};
exports.keys = function(object){
  return objectHash(object, {excludeValues: true, algorithm: 'sha1', encoding: 'hex'});
};
exports.MD5 = function(object){
  return objectHash(object, {algorithm: 'md5', encoding: 'hex'});
};
exports.keysMD5 = function(object){
  return objectHash(object, {algorithm: 'md5', encoding: 'hex', excludeValues: true});
};

// Internals
function applyDefaults(object, options){
  var hashes = crypto.getHashes ? crypto.getHashes() : ['sha1', 'md5'];
  var encodings = ['buffer', 'hex', 'binary', 'base64'];
  
  options = options || {};
  options.algorithm = options.algorithm || 'sha1';
  options.encoding = options.encoding || 'hex';
  options.excludeValues = options.excludeValues ? true : false;
  options.algorithm = options.algorithm.toLowerCase();
  options.encoding = options.encoding.toLowerCase();
  options.ignoreUnknown = options.ignoreUnknown !== true ? false : true; // default to false
  options.respectType = options.respectType === false ? false : true; // default to true
  options.respectFunctionProperties = options.respectFunctionProperties === false ? false : true;
  options.unorderedArrays = options.unorderedArrays !== true ? false : true; // default to false
  options.unorderedSets = options.unorderedSets === false ? false : true; // default to false
  options.replacer = options.replacer || undefined;

  if(typeof object === 'undefined') {
    throw new Error('Object argument required.');
  }

  hashes.push('passthrough');
  // if there is a case-insensitive match in the hashes list, accept it
  // (i.e. SHA256 for sha256)
  for (var i = 0; i < hashes.length; ++i) {
    if (hashes[i].toLowerCase() === options.algorithm.toLowerCase()) {
      options.algorithm = hashes[i];
    }
  }
  
  if(hashes.indexOf(options.algorithm) === -1){
    throw new Error('Algorithm "' + options.algorithm + '"  not supported. ' +
      'supported values: ' + hashes.join(', '));
  }

  if(encodings.indexOf(options.encoding) === -1 &&
     options.algorithm !== 'passthrough'){
    throw new Error('Encoding "' + options.encoding + '"  not supported. ' +
      'supported values: ' + encodings.join(', '));
  }
  
  return options;
}

/** Check if the given function is a native function */
function isNativeFunction(f) {
  if ((typeof f) !== 'function') {
    return false;
  }
  var exp = /^function\s+\w*\s*\(\s*\)\s*{\s+\[native code\]\s+}$/i;
  return exp.exec(Function.prototype.toString.call(f)) != null;
}

function hash(object, options) {
  var hashingStream;
  
  if (options.algorithm !== 'passthrough') {
    hashingStream = crypto.createHash(options.algorithm);
  } else {
    hashingStream = new PassThrough();
  }
  
  if (typeof hashingStream.write === 'undefined') {
    hashingStream.write = hashingStream.update;
    hashingStream.end   = hashingStream.update;
  }
  
  var hasher = typeHasher(options, hashingStream);
  hasher.dispatch(object);
  hashingStream.end(''); // write empty string since .update() requires a string arg
  
  if (typeof hashingStream.read === 'undefined' &&
      typeof hashingStream.digest === 'function') {
    return hashingStream.digest(options.encoding === 'buffer' ? undefined : options.encoding);
  }

  var buf = hashingStream.read();
  if (options.encoding === 'buffer') {
    return buf;
  }
  
  return buf.toString(options.encoding);
}

/**
 * Expose streaming API
 *
 * @param {object} object  Value to serialize
 * @param {object} options  Options, as for hash()
 * @param {object} stream  A stream to write the serializiation to
 * @api public
 */
exports.writeToStream = function(object, options, stream) {
  if (typeof stream === 'undefined') {
    stream = options;
    options = {};
  }
  
  options = applyDefaults(object, options);
  
  return typeHasher(options, stream).dispatch(object);
};

function typeHasher(options, writeTo, context){
  context = context || [];
  
  return {
    dispatch: function(value){
      if (options.replacer) {
        value = options.replacer(value);
      }
      
      var type = typeof value;
      if (value === null) {
        type = 'null';
      }
      
      return this['_' + type](value);
    },
    _object: function(object) {
      var pattern = (/\[object (.*)\]/i);
      var objString = Object.prototype.toString.call(object);
      var objType = pattern.exec(objString);
      if (!objType) { // object type did not match [object ...]
        objType = 'unknown:[' + objString + ']';
      } else {
        objType = objType[1]; // take only the class name
      }
      
      objType = objType.toLowerCase();
            
      var objectNumber = null;

      if ((objectNumber = context.indexOf(object)) >= 0) {
        return this.dispatch('[CIRCULAR:' + objectNumber + ']');
      } else {
        context.push(object);
      }
      
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(object)) {
        writeTo.write('buffer:');
        return writeTo.write(object);
      }

      if(objType !== 'object' && objType !== 'function') {
        if(this['_' + objType]) {
          this['_' + objType](object);
        } else if (options.ignoreUnknown) {
          return writeTo.write('[' + objType + ']');
        } else {
          throw new Error('Unknown object type "' + objType + '"');
        }
      }else{
        var keys = Object.keys(object).sort();
        // Make sure to incorporate special properties, so
        // Types with different prototypes will produce
        // a different hash and objects derived from
        // different functions (`new Foo`, `new Bar`) will
        // produce different hashes.
        // We never do this for native functions since some
        // seem to break because of that.
        if (options.respectType !== false && !isNativeFunction(object)) {
          keys.splice(0, 0, 'prototype', '__proto__', 'constructor');
        }
        
        writeTo.write('object:' + keys.length + ':');
        var self = this;
        return keys.forEach(function(key){
          self.dispatch(key);
          writeTo.write(':');
          if(!options.excludeValues) {
            self.dispatch(object[key]);
          }
          writeTo.write(',');
        });
      }
    },
    _array: function(arr, unordered){
      unordered = typeof unordered !== 'undefined' ? unordered :
        options.unorderedArrays !== false; // default to options.unorderedArrays
      
      var self = this;
      writeTo.write('array:' + arr.length + ':');
      if (!unordered || arr.length <= 1) {
        return arr.forEach(function(entry) {
          return self.dispatch(entry);
        });
      }
      
      // the unordered case is a little more complicated:
      // since there is no canonical ordering on objects,
      // i.e. {a:1} < {a:2} and {a:1} > {a:2} are both false,
      // we first serialize each entry using a PassThrough stream
      // before sorting.
      // also: we can’t use the same context array for all entries
      // since the order of hashing should *not* matter. instead,
      // we keep track of the additions to a copy of the context array
      // and add all of them to the global context array when we’re done
      var contextAdditions = [];
      var entries = arr.map(function(entry) {
        var strm = new PassThrough();
        var localContext = context.slice(); // make copy
        var hasher = typeHasher(options, strm, localContext);
        hasher.dispatch(entry);
        // take only what was added to localContext and append it to contextAdditions
        contextAdditions = contextAdditions.concat(localContext.slice(context.length));
        return strm.read().toString();
      });
      context = context.concat(contextAdditions);
      entries.sort();
      return this._array(entries, false);
    },
    _date: function(date){
      return writeTo.write('date:' + date.toJSON());
    },
    _symbol: function(sym){
      return writeTo.write('symbol:' + sym.toString(), 'utf8');
    },
    _error: function(err){
      return writeTo.write('error:' + err.toString(), 'utf8');
    },
    _boolean: function(bool){
      return writeTo.write('bool:' + bool.toString());
    },
    _string: function(string){
      writeTo.write('string:' + string.length + ':');
      writeTo.write(string, 'utf8');
    },
    _function: function(fn){
      writeTo.write('fn:');
      if (isNativeFunction(fn)) {
        this.dispatch('[native]');
      } else {
        this.dispatch(fn.toString());
      }
      
      if (options.respectFunctionProperties) {
        this._object(fn);
      }
    },
    _number: function(number){
      return writeTo.write('number:' + number.toString());
    },
    _xml: function(xml){
      return writeTo.write('xml:' + xml.toString(), 'utf8');
    },
    _null: function() {
      return writeTo.write('Null');
    },
    _undefined: function() {
      return writeTo.write('Undefined');
    },
    _regexp: function(regex){
      return writeTo.write('regex:' + regex.toString(), 'utf8');
    },
    _uint8array: function(arr){
      writeTo.write('uint8array:');
      return this.dispatch(Array.prototype.slice.call(arr));
    },
    _uint8clampedarray: function(arr){
      writeTo.write('uint8clampedarray:');
      return this.dispatch(Array.prototype.slice.call(arr));
    },
    _int8array: function(arr){
      writeTo.write('uint8array:');
      return this.dispatch(Array.prototype.slice.call(arr));
    },
    _uint16array: function(arr){
      writeTo.write('uint16array:');
      return this.dispatch(Array.prototype.slice.call(arr));
    },
    _int16array: function(arr){
      writeTo.write('uint16array:');
      return this.dispatch(Array.prototype.slice.call(arr));
    },
    _uint32array: function(arr){
      writeTo.write('uint32array:');
      return this.dispatch(Array.prototype.slice.call(arr));
    },
    _int32array: function(arr){
      writeTo.write('uint32array:');
      return this.dispatch(Array.prototype.slice.call(arr));
    },
    _float32array: function(arr){
      writeTo.write('float32array:');
      return this.dispatch(Array.prototype.slice.call(arr));
    },
    _float64array: function(arr){
      writeTo.write('float64array:');
      return this.dispatch(Array.prototype.slice.call(arr));
    },
    _arraybuffer: function(arr){
      writeTo.write('arraybuffer:');
      return this.dispatch(new Uint8Array(arr));
    },
    _url: function(url) {
      return writeTo.write('url:' + url.toString(), 'utf8');
    },
    _map: function(map) {
      writeTo.write('map:');
      var arr = Array.from(map);
      return this._array(arr, options.unorderedSets !== false);
    },
    _set: function(set) {
      writeTo.write('set:');
      var arr = Array.from(set);
      return this._array(arr, options.unorderedSets !== false);
    },
    _blob: function() {
      if (options.ignoreUnknown) {
        return writeTo.write('[blob]');
      }
      
      throw Error('Hashing Blob objects is currently not supported\n' +
        '(see https://github.com/puleos/object-hash/issues/26)\n' +
        'Use "options.replacer" or "options.ignoreUnknown"\n');
    },
    _domwindow: function() { return writeTo.write('domwindow'); },
    /* Node.js standard native objects */
    _process: function() { return writeTo.write('process'); },
    _timer: function() { return writeTo.write('timer'); },
    _pipe: function() { return writeTo.write('pipe'); },
    _tcp: function() { return writeTo.write('tcp'); },
    _udp: function() { return writeTo.write('udp'); },
    _tty: function() { return writeTo.write('tty'); },
    _statwatcher: function() { return writeTo.write('statwatcher'); },
    _securecontext: function() { return writeTo.write('securecontext'); },
    _connection: function() { return writeTo.write('connection'); },
    _zlib: function() { return writeTo.write('zlib'); },
    _context: function() { return writeTo.write('context'); },
    _nodescript: function() { return writeTo.write('nodescript'); },
    _httpparser: function() { return writeTo.write('httpparser'); },
    _dataview: function() { return writeTo.write('dataview'); },
    _signal: function() { return writeTo.write('signal'); },
    _fsevent: function() { return writeTo.write('fsevent'); },
    _tlswrap: function() { return writeTo.write('tlswrap'); }
  };
}

// Mini-implementation of stream.PassThrough
// We are far from having need for the full implementation, and we can
// make assumtions like "many writes, then only one final read"
// and we can ignore encoding specifics
function PassThrough() {
  return {
    buf: '',
    
    write: function(b) {
      this.buf += b;
    },
    end: function(b) {
      this.buf += b;
    },
    read: function() {
      return this.buf;
    }
  };
}
