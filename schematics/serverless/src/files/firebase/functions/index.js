'use strict';
const server = require('./dist/server');
const functions = require('firebase-functions');

const http = functions.https.onRequest((request, response) => {
    if (!request.path) {
    request.url = "/" + request.url;
}
return server.app(request, response);
});

module.exports = {
    http
}