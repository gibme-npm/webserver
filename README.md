# Simple Express.js Application Wrapper

```typescript
import WebServer, { Logger } from '@gibme/webserver';

(async() => {
    const app = await WebServer.create();
    
    app.get('/', (request, response) => {
        return response.json({ success: true });
    })
    
    await app.start();
    
    Logger.info('Listening on http%s://%s:%s',
        app.ssl ? 's' : '',
        app.bindHost,
        app.bindPort);
})();
```
