# Simple Express.js Application Wrapper

This wrapper makes it very easy to construct a new instance of an [Express.js](https://expressjs.com/) web server application using HTTP or HTTPs.

It includes preloaded recommended headers, 404 handling, compression, and auto-parses request bodies.

In addition, it exposes [WebSocket](https://en.wikipedia.org/wiki/WebSocket) support via an additional method signature of `.ws('path', (socket, request) => void)` to aid with the development of WebSocket application(s).

It also supports auto-generating development SSL certificates for the hostnames supplied and installing a development root CA into the host OS. This mode is **NOT** for production use.

## Documentation

[https://gibme-npm.github.io/webserver/](https://gibme-npm.github.io/webserver/)

## Sample Code

```typescript
import WebServer, { Logger } from '@gibme/webserver';

(async() => {
    const app = await WebServer.create();
    
    app.get('/', (request, response) => {
        return response.json({ success: true });
    })

    app.ws('/wss', (socket) => {
        socket.on('message', msg => {
            // simply echo the message back
            socket.send(msg);
        });
    });
    
    await app.start();
    
    Logger.info('Listening on http%s://%s:%s',
        app.ssl ? 's' : '',
        app.bindHost,
        app.bindPort);
})();
```
