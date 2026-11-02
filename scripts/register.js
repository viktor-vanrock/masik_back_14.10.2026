'use strict';
const Module = require('module');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.endsWith('.js') && parent && parent.filename) {
    try {
      return originalResolve.call(this, request, parent, isMain, options);
    } catch (e) {
      try {
        return originalResolve.call(this, request.slice(0, -3) + '.ts', parent, isMain, options);
      } catch {
        throw e;
      }
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
