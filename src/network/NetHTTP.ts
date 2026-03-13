import HTTP from 'http';
import HTTPS from 'https';
import Reileta from '../Main';
import NetExpress, { Next, Request, Response } from './NetExpress';
import Express from 'express';
import Debug from '../utils/Debug';
import { ErrorCodes } from '../utils/Constants';
import NetData from './NetData';
import { ErrorMessage } from '../utils/Utils';
import { join } from 'path';
import { cwd } from 'process';
import NetSocket from './NetSocket';
import cors from 'cors';
import Env from '../utils/Environment';
import { Security } from '../utils/Security';
import Schemas from '../utils/Schemas';


export default class NetHTTP {
    server: HTTP.Server;
    express: NetExpress;
    socket: NetSocket;

    constructor(private readonly app: Reileta) {
        this.express = new NetExpress(this.app, this);
        this.server = Env.sync('USE_SSL') ? this.initWithSSL() : this.initUnsecure();
        this.socket = new NetSocket(this.app, this);
        this.app.emit('http:init', this.server);
        this.express.server.use((req, res, next) => this.onRequest(req as Request, res as Response, next));
        this.express.server.use(Express.static(join(cwd(), 'public')));
        this.express.server.get('/schemas/:name', (req, res) => this.serveSchema(req as Request<{ name: string }>, res as Response));
        for (const [k, v] of Object.entries(Env.sync('CUSTOM_CORS')) as any) {
            Debug.debug(`Adding CORS for ${k} -> ${JSON.stringify(v)}`);
            this.express.server.use(k, cors(v));
        }
    }

    private initWithSSL() {
        return HTTPS.createServer({
            key: Security.privateToPem(Security.privateKey),
            cert: Security.certificateToPem(Security.publicCertificate),
        }, this.express.server);
    }

    private initUnsecure() {
        return HTTP.createServer(this.express.server);
    }

    private serveSchema(request: Request<{ name: string }>, response: Response) {
        const name = request.params.name;
        const schemaPath = join(Schemas.schemaPath, name);
        return response.sendFile(schemaPath, (err) => {
            if (err) {
                Debug.error(`Error sending schema file ${name}:`, err);
                return response.status(404).send('Schema not found');
            }
        });
    }

    onRequest(request: Request, response: Response, next: Next) {
        response.oldsend = response.send;
        response.send = (body: any) => this.send(body, request, response, body);
        if (this.app.ready_at === null) {
            if (request.url.startsWith('/api/'))
                return response.send(new ErrorMessage(ErrorCodes.ServerNotReady));
            else return response.sendStatus(503);
        }
        request.data = new NetData(this.app, request);
        if (!Env.sync('IGNORE_LOG_PATHS').some(pattern => new RegExp(pattern).test(request.url.split('?')[0])))
            Debug.log(`[${Env.sync('HIDE_IP') ? `<hidden>` : request.data.ip}] ${request.method} ${request.url}`);
        return next();
    }


    handler() {
        this.express.server.use('/api/*', (req, res, next) => this.onEnd(req as Request, res as Response, next));
    }

    private send(body: any, request: Request, response: Response, next: Next) {
        if (typeof body === 'object') {
            if (body instanceof ErrorMessage) {
                body = {
                    error: body.toJSON(),
                    data: body.data || null,
                };
                Debug.error("Error:", body.error, "for", request.url);
            }
            if (body.error) {
                if (typeof body.error.status !== 'number')
                    body.error.status = 400;
                response.status(body.error.status);
            } else body = { data: body };
            body.time = Date.now();
            body.request = request.originalUrl;
        }
        for (const header of Object.entries(this.app.server.defaultHeaders))
            response.setHeader(header[0], header[1]);
        return response.oldsend(body);
    }

    private onEnd(req: Request, res: Response, next: Next) {
        return res.send(new ErrorMessage(ErrorCodes.NotImplemented));
    }

    start(port = Env.sync('NODE_PORT')) {
        // Configure server timeouts
        this.server.timeout = Env.sync('UPLOAD_TIMEOUT');
        this.server.keepAliveTimeout = 65000; // 65 seconds
        this.server.headersTimeout = 66000; // 66 seconds

        // print all routes
        let routes = this.express.server._router.stack;
        let methodCount = 0;
        for (const route of routes)
            if (route.route && route.route.path)
                for (const method in route.route.methods)
                    methodCount = Math.max(methodCount, method.length);
        for (const route of routes)
            if (route.route && route.route.path)
                for (const method in route.route.methods)
                    Debug.debug(`${method.toUpperCase().padEnd(methodCount)} ${route.route.path}`);

        return new Promise<void | Error>((resolve, reject) => {
            try {
                this.server.listen(port, () => {
                    Debug.log(`HTTP server started on port ${port}`);
                    resolve();
                });
                this.server.on('error', (error) => {
                    Debug.error(`HTTP server error: ${error}`);
                    reject(error);
                });
            } catch (error) {
                Debug.error(`HTTP server error: ${error}`);
                reject(error);
            }
        });
    }
}
