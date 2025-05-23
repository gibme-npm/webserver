# Simple Express.js Application Wrapper

This wrapper makes it very easy to construct a new instance of an [Express.js](https://expressjs.com/) web server application using HTTP or HTTPs.

Features include:

* Preloaded recommended headers (optional)
* Automatic 404 handling (optional)
* Compression (optional)
* Auto-parsing of request bodies
* [WebSocket](https://en.wikipedia.org/wiki/WebSocket) via additional method signature of `.ws('path', (socket, request) => void)`
* Simple [cloudflared](https://npmjs.com/package/cloudflared) support to spin up test tunnels using [Cloudflare](https://cloudflare.com)
  * **Note**: The public URLs will be randomly generated by Cloudflare
* Attempts to decode the HTTP header, `Authorization` automagically into the `Request.authorization` property

## Documentation

[https://gibme-npm.github.io/webserver/](https://gibme-npm.github.io/webserver/)

## Sample Code

```typescript
import WebServer, { Logger } from '@gibme/webserver';

(async() => {
    const app = WebServer({
        autoStartCloudflared: true
    });
    
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
    
    Logger.info('Listening on: %s', app.localUrl);
    Logger.info('Listening on: %s', app.tunnelUrl);
    Logger.info('Listening on: %s', app.url);
})();
```
