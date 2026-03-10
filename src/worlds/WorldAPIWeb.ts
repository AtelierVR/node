import Reileta from '../Main';
import WorldManager, { IMakeWorld, IMakeWorldAsset } from './WorldManager';
import NetExpress, { Request, Response } from "../network/NetExpress";
import { ErrorMessage } from '../utils/Utils';
import { ErrorCodes } from '../utils/Constants';
import Express from 'express';
import User from '../users/User';
import { readFileSync } from 'fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import World from './World';
import WorldIdentifier from './WorldIdentifier';
import UserIdentifier from '../users/UserIdentifier';
import Debug from '../utils/Debug';
import processingQueue, { ProcessingStatus } from '../assets/AssetProcessingQueue';
import { WorldAssetProcessor } from './WorldAssetProcessor';
import {
    AnyProcessingJobResponse,
    ProcessingJobActiveResponse,
    ProcessingJobCompletedResponse,
    ProcessingJobFailedResponse,
    ProcessingJobEmptyResponse
} from '../assets/ProcessingJobResponse';

export default class WorldAPIWeb {
    private worldProcessor: WorldAssetProcessor;

    constructor(private readonly app: Reileta, private readonly manager: WorldManager) {
        // Créer et enregistrer le processeur pour les assets de monde
        this.worldProcessor = new WorldAssetProcessor(manager);
        processingQueue.registerProcessor('world', this.worldProcessor);

        this.app.http.express.server.get('/api/worlds', (req, res) => this.searchHandler(req as Request, res as Response));
        this.app.http.express.server.put('/api/worlds', Express.json(), NetExpress.validate('worlds/create'), (req, res) => this.handleCreateWorld(req as Request, res as Response));
        this.app.http.express.server.get('/api/worlds/:world_id', (req, res) => this.handleWorld(req as Request<{ world_id: string }>, res as Response));
        this.app.http.express.server.delete('/api/worlds/:world_id', (req, res) => this.handleDeleteWorld(req as Request<{ world_id: string }>, res as Response));
        this.app.http.express.server.post('/api/worlds/:world_id', Express.json(), NetExpress.validate('worlds/update'), (req, res) => this.handleUpdateWorld(req as Request<{ world_id: string }>, res as Response));
        this.app.http.express.server.get('/api/worlds/:world_id/assets', (req, res) => this.handleWorldAsset(req as Request<{ world_id: string }>, res as Response));
        this.app.http.express.server.put('/api/worlds/:world_id/assets', Express.json(), NetExpress.validate('worlds/asset/create'), (req, res) => this.handleCreateWorldAsset(req as Request<{ world_id: string }>, res as Response));
        this.app.http.express.server.post('/api/worlds/:world_id/assets/:asset_id/file', NetExpress.uploadTimeout(), this.app.http.express.upload.single('file'), NetExpress.handleMulterError(), (req: any, res: any) => this.handleUploadWorldAssetFile(req as Request<{ world_id: string, asset_id: string }>, res as Response));
        this.app.http.express.server.get('/api/worlds/:world_id/assets/:asset_id/file', (req, res) => this.handleDownloadWorldAssetFile(req as Request<{ world_id: string, asset_id: string }>, res as Response));
        this.app.http.express.server.get('/api/worlds/:world_id/assets/:asset_id/status', (req, res) => this.handleAssetStatus(req as Request<{ world_id: string, asset_id: string }>, res as Response));

        this.app.http.express.server.get('/api/worlds/:world_id/thumbnail', (req, res) => this.handleGetThumbnail(req as Request<{ world_id: string }>, res as Response));
        this.app.http.express.server.post('/api/worlds/:world_id/thumbnail', NetExpress.uploadTimeout(), this.app.http.express.upload.single('file'), NetExpress.handleMulterError(), (req: any, res: any) => this.handleUploadThumbnail(req as Request<{ world_id: string }>, res as Response));
    }

    private static nextAt(): Date {
        const now = Date.now();
        return new Date(now + 5000);
    }

    async handleWorldAsset(request: Request<{ world_id: string }>, response: Response) {
        let world_id: number = /^\d+$/.test(request.params.world_id) ? parseInt(request.params.world_id) : 0;
        let offset: number = typeof request.query.offset === 'string' && /^\d+$/.test(request.query.offset) ? parseInt(request.query.offset) : 0;
        let limit: number = typeof request.query.limit === 'string' && /^\d+$/.test(request.query.limit) ? parseInt(request.query.limit) : 10;
        let show_empty: boolean = request.query.hasOwnProperty('empty') && (request.query.empty === 'true' || request.query.empty === '');
        if (!WorldManager.isValidWorldId(world_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world_id', 'world id'));
        if (offset < 0) offset = 0;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;
        let versions: number[] = [];
        let engines: string[] = [];
        let platforms: string[] = [];
        if (request.query.version) {
            if (typeof request.query.version === 'string')
                versions = request.query.version.split(',').map(v => parseInt(v));
            else if (Array.isArray(request.query.version))
                versions = request.query.version.map(v => parseInt(v.toString()));
        }
        if (request.query.engine) {
            if (typeof request.query.engine === 'string')
                engines = request.query.engine.split(',');
            else if (Array.isArray(request.query.engine))
                engines = request.query.engine.map(e => e.toString());
        }
        if (request.query.platform) {
            if (typeof request.query.platform === 'string')
                platforms = request.query.platform.split(',');
            else if (Array.isArray(request.query.platform))
                platforms = request.query.platform.map(p => p.toString());
        }
        var result = await this.manager.findWorldAssets(world_id, {
            offset,
            limit,
            versions: versions.length > 0 ? versions : undefined,
            engines: engines.length > 0 ? engines : undefined,
            platforms: platforms.length > 0 ? platforms : undefined,
            show_empty
        });
        return response.send({
            total: result.total,
            limit,
            offset,
            assets: result.assets.map<IRWorldAsset>(asset => ({
                id: asset.id,
                version: asset.version,
                engine: asset.engine,
                platform: asset.platform,
                is_empty: asset.isEmpty() || undefined,
                url: asset.isEmpty() ? null : (
                    asset.getURL()?.href || new URL(`/api/worlds/${world_id}/assets/${asset.id}/file`, this.app.server.getInfos().gateways.http)?.href
                ),
                mods: asset.modReferences.map(mod => mod.toString(this.app.server.getInfos().address)),
                features: asset.features,
                hash: asset.getHash() || null,
                size: asset.getSize() || null
            }))
        });
    }

    async handleDownloadWorldAssetFile(request: Request<{ world_id: string, asset_id: string }>, response: Response) {
        let world_id: number = /^\d+$/.test(request.params.world_id) ? parseInt(request.params.world_id) : 0;
        let asset_id: number = /^\d+$/.test(request.params.asset_id) ? parseInt(request.params.asset_id) : 0;
        if (!WorldManager.isValidWorldId(world_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world_id', 'world id'));
        if (!WorldManager.isValidAssetId(asset_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'asset_id', 'asset id'));
        let world = await this.manager.findWorldById(world_id);
        if (!world)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));
        let asset = await this.manager.findWorldAssetById(asset_id);
        if (!asset || asset.world_id !== world_id)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World Asset'));
        let file = asset.getFile();
        if (!file)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World Asset File'));
        response.sendFile(file);
    }

    async searchHandler(request: Request, response: Response) {
        var { query, limit, offset, id } = request.query;
        if (!limit || typeof limit !== 'string') limit = '10';
        if (!offset || typeof offset !== 'string') offset = '0';
        if (!/^\d+$/.test(limit)) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'query', 'limit'));
        if (!/^\d+$/.test(offset)) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'query', 'offset'));
        var ilimit = parseInt(limit);
        var ioffset = parseInt(offset);
        if (ilimit > 100) ilimit = 100;
        if (ioffset < 0) ioffset = 0;
        let ids: string[] = [];
        let querys: string | undefined = typeof query === 'string' && query.length > 0 ? query : undefined;

        if (typeof id === 'string') {
            if (!WorldManager.isValidWorldId(parseInt(id)))
                return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'id', 'search'));
            ids.push(id);
        } else if (Array.isArray(id))
            for (let i of id.map(i => i.toString())) {
                if (!WorldManager.isValidWorldId(parseInt(i)))
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'id', 'search'));
                ids.push(i);
            }
        let results: { worlds: World[]; total: number; } = { worlds: [], total: 0 };
        if (ids.length > 0)
            results = await this.manager.searchWorldsByIds(ids.map(id => parseInt(id)), ilimit, ioffset);
        else {
            var res = await this.manager.searchWorldsByQuery(querys, ilimit, ioffset);
            results.worlds = results.worlds.concat(res.worlds);
            results.total += res.total;
        }

        let address = this.app.server.getInfos().address;
        let http = this.app.server.getInfos().gateways.http;

        return response.send({
            total: results.total,
            search: query,
            ids: ids,
            limit: ilimit,
            offset: ioffset,
            worlds: await Promise.all<IRWorld>(results.worlds.map<Promise<IRWorld>>(async world => ({
                id: world.id,
                title: world.title,
                description: world.description,
                server: address,
                capacity: world.capacity,
                tags: world.getTags(),
                alias: await world.alias(),
                owner: world.ownerIdentifier.toString(address),
                contributors: world.contributor_refs.map(ref => UserIdentifier.fromString(ref).toString(address)),
                thumbnail: world.getThumbnail(http)?.href || null,
            })))
        });
    }

    async handleCreateWorld(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canCreateWorld())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'create worlds (permission)'));

        var data: IMakeWorld = {
            id: request.body.id || undefined,
            title: request.body.title || undefined,
            description: request.body.description || undefined,
            capacity: request.body.capacity || 0,
            thumbnail: request.body.thumbnail || undefined,
            contributor_refs: []
        };

        for (const ref of request.body.contributors || []) {
            const id = UserIdentifier.fromString(ref);
            if (id) data.contributor_refs.push(id.toString());
        }

        if (request.body.id > 0 && await this.manager.findWorldById(request.body.id))
            return response.send(new ErrorMessage(ErrorCodes.AlreadyExists, 'world'));
        let world = await this.manager.createWorld(data, user);
        if (!world)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'create world'));
        if (!(await world.IsOwner(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'create worlds (owner)'));
        let address = this.app.server.getInfos().address;
        let http = this.app.server.getInfos().gateways.http;
        return response.send<IRWorld>({
            id: world.id,
            title: world.title || null,
            description: world.description || null,
            server: address,
            thumbnail: world.getThumbnail(http)?.href || null,
            capacity: world.capacity,
            tags: world.getTags(),
            alias: await world.alias(),
            owner: world.ownerIdentifier.toString(address),
            contributors: world.contributor_refs.map(ref => UserIdentifier.fromString(ref).toString(address)),
        });
    }

    async handleDeleteWorld(request: Request<{ world_id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canDeleteWorld())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'delete worlds'));
        let id: number = /^\d+$/.test(request.params.world_id) ? parseInt(request.params.world_id) : 0;
        let world = null;
        if (WorldManager.isValidWorldId(id))
            world = await this.manager.findWorldById(id);
        if (!world)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));
        if (!(await world.IsOwner(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'delete worlds'));
        await world.delete();
        return response.send({ success: true });
    }

    async handleUpdateWorld(request: Request<{ world_id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canUpdateWorld())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update worlds'));
        let id: number = /^\d+$/.test(request.params.world_id) ? parseInt(request.params.world_id) : 0;
        let world: World | null = null;
        if (WorldManager.isValidWorldId(id))
            world = await this.manager.findWorldById(id);
        if (!world)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));
        if (!(await world.CanModify(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update worlds'));

        Debug.log('update world', request.body);
        world.title = request.body.title || world.title;
        world.description = request.body.description || world.description;
        world.capacity = request.body.capacity || world.capacity;
        world.thumbnail = request.body.thumbnail || world.thumbnail;
        // Only owner can modify contributors
        if (request.body.contributors && (await world.IsOwner(user))) {
            let con: UserIdentifier[] = [];
            for (const ref of request.body.contributors) {
                const id = UserIdentifier.fromString(ref);
                if (id) con.push(id);
            }
            world.contributor_refs = con.map(id => id.toString());
        }

        if (!await world.save())
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'update world'));

        let address = this.app.server.getInfos().address;
        let http = this.app.server.getInfos().gateways.http;
        return response.send<IRWorld>({
            id: world.id,
            title: world.title || null,
            description: world.description || null,
            server: address,
            thumbnail: world.getThumbnail(http)?.href || null,
            capacity: world.capacity,
            tags: world.getTags(),
            alias: await world.alias(),
            owner: world.ownerIdentifier.toString(address),
            contributors: world.contributor_refs.map(ref => UserIdentifier.fromString(ref).toString(address)),
        });
    }

    async handleNetWorld(request: Request<{ world_id: string }>, response: Response, worldIdentifier: WorldIdentifier) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.canFetchExternal())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'fetch external world'));
        const ns = await this.app.netServers.findOrInitServer(worldIdentifier.server!);
        if (ns instanceof Error) {
            Debug.error(`Failed to find or init NetServer for ${worldIdentifier.server}: ${ns.message}`);
            return response.send(new ErrorMessage(ErrorCodes.ServerNotFound));
        }
        const url = new URL(`/api/worlds/${worldIdentifier.identifier}`, `http://${ns.address}`);
        const res = await ns.fetch<IRWorld>(url, 'worlds/info_response');
        if (res.error) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));
        if (!res.data) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));
        return response.send<IRWorld>(res.data);
    }

    async handleWorld(request: Request<{ world_id: string }>, response: Response) {
        const worldIdentifier = WorldIdentifier.fromString(request.params.world_id);
        if (!worldIdentifier)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world_id', 'world id'));
        if (!worldIdentifier.isLocal())
            return this.handleNetWorld(request, response, worldIdentifier);
        let id = worldIdentifier.identifier;
        if (!WorldManager.isValidWorldId(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world_id', 'world id'));
        let world = await this.manager.findWorldById(id);
        if (world) {
            let address = this.app.server.getInfos().address;
            let http = this.app.server.getInfos().gateways.http;
            return response.send<IRWorld>({
                id: world.id,
                title: world.title || null,
                description: world.description || null,
                server: address,
                thumbnail: world.getThumbnail(http)?.href || null,
                capacity: world.capacity,
                tags: world.getTags(),
                alias: await world.alias(),
                owner: world.ownerIdentifier.toString(address),
                contributors: world.contributor_refs.map(ref => UserIdentifier.fromString(ref).toString(address)),
            });
        }
        return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));
    }

    async handleCreateWorldAsset(request: Request<{ world_id: string }>, response: Response) {
        let id: number = /^\d+$/.test(request.params.world_id) ? parseInt(request.params.world_id) : 0;
        if (!WorldManager.isValidWorldId(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world_id', 'world id'));
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canCreateWorldAsset())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'create world assets'));
        var data: IMakeWorldAsset = {
            id: request.body.id || undefined,
            version: request.body.version,
            engine: request.body.engine,
            platform: request.body.platform,
            url: request.body.url || undefined,
            hash: request.body.hash || undefined,
            size: request.body.size || undefined,
            world_id: id
        };
        Debug.log('create world asset', data, request.body);
        data.world_id = id;
        const world = await this.manager.findWorldById(id);
        if (!world)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));
        if (!(await world.CanModify(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'create world assets'));
        const check = await this.manager.findWorldAssetByIndex(id, data.version, data.engine, data.platform);
        Debug.log('check', check, data);
        if (check)
            return response.send(new ErrorMessage(ErrorCodes.AlreadyExists, 'world asset', 'version, engine or platform'));
        Debug.log('create world asset', data);
        let asset = await this.manager.createWorldAsset(data);
        if (asset) {
            let address = this.app.server.getInfos().address;
            return response.send<IRWorldAsset>({
                id: asset.id,
                version: asset.version,
                engine: asset.engine,
                platform: asset.platform,
                is_empty: asset.isEmpty() || undefined,
                url: asset.isEmpty() ? null : (
                    asset.getURL()?.href || new URL(`/api/worlds/${id}/assets/${asset.id}/file`, this.app.server.getInfos().gateways.http)?.href
                ),
                mods: asset.modReferences.map(mod => mod.toString(address)),
                features: asset.features,
                hash: asset.getHash() || null,
                size: asset.getSize() || null
            });
        }
        return response.send(new ErrorMessage(ErrorCodes.InternalError, 'create world asset'));
    }

    async handleUploadWorldAssetFile(request: Request<{ world_id: string, asset_id: string }>, response: Response) {
        let world_id: number = /^\d+$/.test(request.params.world_id) ? parseInt(request.params.world_id) : 0;
        let asset_id: number = /^\d+$/.test(request.params.asset_id) ? parseInt(request.params.asset_id) : 0;
        Debug.log('upload world asset file', world_id, asset_id, request.file);

        let file = request.file;
        if (!file)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file', 'file'));

        if (!WorldManager.isValidWorldId(world_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world_id', 'world id'));
        if (!WorldManager.isValidAssetId(asset_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'asset_id', 'asset id'));

        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canUploadWorldAssetFile())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'upload world assets'));

        const world = await this.manager.findWorldById(world_id);
        if (!world)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));
        if (!(await world.CanModify(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'upload world assets'));
        let asset = await this.manager.findWorldAssetById(asset_id);
        if (!asset || asset.world_id !== world_id)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World Asset'));

        // Calculer et vérifier le hash
        var hash = createHash('sha256').update(readFileSync(file.path)).digest('hex');
        var headerhash = request.header('x-file-hash');
        if (headerhash && headerhash !== hash)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file content', 'hash'));

        // Ajouter à la queue de processing (traitement asynchrone)
        const job = processingQueue.addJob({
            context: {
                type: 'world',
                asset_id: asset.id,
                parent_id: world.id,
                file_path: file.path,
                hash: hash
            },
            progress: { progress: 0, status: ProcessingStatus.PENDING, message: 'Queued' }
        });

        // Réponse immédiate 202 Accepted avec l'état du job
        return response.status(202).send<ProcessingJobActiveResponse>({
            message: 'Asset queued for processing',
            status: (job.progress.status || ProcessingStatus.PENDING) as ProcessingStatus.PENDING | ProcessingStatus.PROCESSING,
            progress: job.progress.progress,
            queue_position: processingQueue.getQueueLength(),
            created_at: job.created_at.getTime(),
            started_at: job.started_at?.getTime(),
            next_at: WorldAPIWeb.nextAt().getTime()
        });
    }

    async handleAssetStatus(request: Request<{ world_id: string, asset_id: string }>, response: Response) {
        let world_id: number = /^\d+$/.test(request.params.world_id) ? parseInt(request.params.world_id) : 0;
        let asset_id: number = /^\d+$/.test(request.params.asset_id) ? parseInt(request.params.asset_id) : 0;

        if (!WorldManager.isValidWorldId(world_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world_id', 'world id'));
        if (!WorldManager.isValidAssetId(asset_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'asset_id', 'asset id'));

        // Vérifier que l'asset existe
        let asset = await this.manager.findWorldAssetById(asset_id);
        if (!asset || asset.world_id !== world_id)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World Asset'));

        // Récupérer le job de processing
        const job = processingQueue.getJob(asset_id);

        if (job) {
            const status = job.progress.status || ProcessingStatus.PENDING;

            // Job échoué
            if (status === ProcessingStatus.FAILED) {
                return response.send<ProcessingJobFailedResponse>({
                    status: ProcessingStatus.FAILED,
                    progress: job.progress.progress,
                    message: job.progress.message || 'Processing failed',
                    error: job.error?.message || 'Unknown error',
                    created_at: job.created_at.getTime(),
                    started_at: job.started_at?.getTime(),
                    completed_at: job.done_at!.getTime()
                });
            }

            // Job terminé avec succès
            if (status === ProcessingStatus.COMPLETED) {
                return response.send<ProcessingJobCompletedResponse>({
                    status: ProcessingStatus.COMPLETED,
                    progress: 100,
                    message: job.progress.message || 'Processing completed',
                    hash: job.context.hash,
                    size: asset.getSize(),
                    created_at: job.created_at.getTime(),
                    started_at: job.started_at?.getTime(),
                    completed_at: job.done_at!.getTime()
                });
            }

            // Job en cours ou en attente
            return response.send<ProcessingJobActiveResponse>({
                status: status as ProcessingStatus.PENDING | ProcessingStatus.PROCESSING,
                progress: job.progress.progress,
                message: job.progress.message || 'Processing',
                queue_position: status === ProcessingStatus.PENDING ? processingQueue.getQueueLength() : 0,
                created_at: job.created_at.getTime(),
                started_at: job.started_at?.getTime(),
                next_at: WorldAPIWeb.nextAt().getTime()
            });
        }

        // Pas de job en cours, l'asset est soit déjà traité soit jamais uploadé
        if (!asset.isEmpty()) {
            // Asset déjà traité avec succès
            return response.send<ProcessingJobCompletedResponse>({
                status: ProcessingStatus.COMPLETED,
                progress: 100,
                message: 'Asset already processed',
                hash: asset.getHash()!,
                size: asset.getSize(),
                created_at: 0,
                completed_at: 0
            });
        }

        // Asset vide, jamais uploadé
        return response.send<ProcessingJobEmptyResponse>({
            status: 'empty',
            progress: 0,
            message: 'No file uploaded yet',
            created_at: 0
        });
    }

    async handleGetThumbnail(request: Request<{ world_id: string }>, response: Response) {
        let world_id: number = /^\d+$/.test(request.params.world_id) ? parseInt(request.params.world_id) : 0;
        if (!WorldManager.isValidWorldId(world_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world_id', 'world id'));

        let world = await this.manager.findWorldById(world_id);
        if (!world) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));

        return this.handleThumbnail({ world }, response);
    }

    async handleThumbnail({ world }: { world: World }, response: Response) {
        if (!world) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));

        if (world.isLocalThumbnail()) {
            let path = world.getLocalThumbnailPath() as string;
            let [_, hash, type, ext] = basename(path).match(/^([0-9a-fA-F]+)-([a-zA-Z]+)\.([a-zA-Z]+)$/) || [];
            response.type(`image/${type}`);
            response.set('Content-Type', `image/${type}`);
            response.set('Content-Disposition', `inline; filename=thumbnail-${world.id}.${type}`);
            response.set('X-File-Hash', hash);
            return response.sendFile(path);
        }

        let http = this.app.server.getInfos().gateways.http;
        let thumbnail = world.getThumbnail(http);
        if (thumbnail) return response.redirect(thumbnail.href);

        return response.send(new ErrorMessage(ErrorCodes.NotFound, 'thumbnail'));
    }

    async handleUploadThumbnail(request: Request<{ world_id: string }>, response: Response) {
        let world_id: number = /^\d+$/.test(request.params.world_id) ? parseInt(request.params.world_id) : 0;
        if (!WorldManager.isValidWorldId(world_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world_id', 'world id'));

        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        // get user
        let user = await request.data.getData() as User | null;
        if (!user || !user.canUpdateWorld() || !user.canUploadFile())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update world'));

        let world = await this.manager.findWorldById(world_id);
        if (!world) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'World'));

        if (!(await world.CanModify(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update world'));

        // check file exist
        let file = request.file;
        if (!file) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file', 'file'));

        // check file type
        const reg = /image\/(png|jpeg|jpg|gif)/;
        if (!reg.test(file.mimetype))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file', 'Image'));

        // check file hash
        var hash = createHash('sha256').update(readFileSync(file.path)).digest('hex');
        var headerhash = request.header('x-file-hash');
        if (headerhash && headerhash !== hash)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file content', 'hash'));

        // save file
        let thumbnail = world.setThumbnailFile(file, hash);
        if (!thumbnail) return response.send(new ErrorMessage(ErrorCodes.InternalError, 'upload thumbnail'));

        // update world
        if (!await world.save()) return response.send(new ErrorMessage(ErrorCodes.InternalError, 'update world'));

        // send response like GET
        return this.handleThumbnail({ world }, response);
    }
}

export interface IRWorld {
    id: number;
    title: string | null;
    description: string | null;
    capacity: number;
    tags: string[];
    thumbnail: string | null;
    alias: {
        key: string;
        value: string;
    }[];
    owner: string;
    contributors: string[];
    server: string;
}

export interface IRWorldAsset {
    id: number;
    version: number;
    engine: string;
    platform: string;
    is_empty?: boolean;
    url: string | null;
    hash: string | null;
    size: number | null;
    mods: string[];
    features: string[];
}