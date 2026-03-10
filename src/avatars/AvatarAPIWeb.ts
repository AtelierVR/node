import Reileta from '../Main';
import AvatarManager, { IMakeAvatar, IMakeAvatarAsset, IUpdateAvatar, IAvatarSelector } from './AvatarManager';
import NetExpress, { Request, Response } from "../network/NetExpress";
import { ErrorMessage, checkValidAssetFile } from '../utils/Utils';
import { ErrorCodes } from '../utils/Constants';
import Express from 'express';
import User from '../users/User';
import { readFileSync, createReadStream, statSync } from 'fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import Avatar from './Avatar';
import AvatarIdentifier from './AvatarIdentifier';
import Debug from '../utils/Debug';
import processingQueue, { ProcessingStatus } from '../assets/AssetProcessingQueue';
import { AvatarAssetProcessor } from './AvatarAssetProcessor';
import {
    ProcessingJobActiveResponse,
    ProcessingJobCompletedResponse,
    ProcessingJobFailedResponse,
    ProcessingJobEmptyResponse
} from '../assets/ProcessingJobResponse';

export default class AvatarAPIWeb {
    private avatarProcessor: AvatarAssetProcessor;

    constructor(private readonly app: Reileta, private readonly manager: AvatarManager) {
        // Créer le processeur pour les assets d'avatar
        this.avatarProcessor = new AvatarAssetProcessor(manager);

        // Enregistrer le processeur dans la queue globale
        processingQueue.registerProcessor('avatar', this.avatarProcessor);

        // Routes API
        this.app.http.express.server.get('/api/avatars', (req, res) => this.searchHandler(req as Request, res as Response));
        this.app.http.express.server.put('/api/avatars', Express.json(), NetExpress.validate('avatars/create'), (req, res) => this.handleCreateAvatar(req as Request, res as Response));
        this.app.http.express.server.get('/api/avatars/:avatar_id', (req, res) => this.handleAvatar(req as Request<{ avatar_id: string }>, res as Response));
        this.app.http.express.server.delete('/api/avatars/:avatar_id', (req, res) => this.handleDeleteAvatar(req as Request<{ avatar_id: string }>, res as Response));
        this.app.http.express.server.post('/api/avatars/:avatar_id', Express.json(), NetExpress.validate('avatars/update'), (req, res) => this.handleUpdateAvatar(req as Request<{ avatar_id: string }>, res as Response));
        this.app.http.express.server.get('/api/avatars/:avatar_id/assets', (req, res) => this.handleAvatarAsset(req as Request<{ avatar_id: string }>, res as Response));
        this.app.http.express.server.put('/api/avatars/:avatar_id/assets', Express.json(), NetExpress.validate('avatars/asset/create'), (req, res) => this.handleCreateAvatarAsset(req as Request<{ avatar_id: string }>, res as Response));
        this.app.http.express.server.post('/api/avatars/:avatar_id/assets/:asset_id/file', NetExpress.uploadTimeout(), this.app.http.express.upload.single('file'), NetExpress.handleMulterError(), (req: any, res: any) => this.handleUploadAvatarAssetFile(req as Request<{ avatar_id: string, asset_id: string }>, res as Response));
        this.app.http.express.server.get('/api/avatars/:avatar_id/assets/:asset_id/file', (req, res) => this.handleDownloadAvatarAssetFile(req as Request<{ avatar_id: string, asset_id: string }>, res as Response));
        this.app.http.express.server.get('/api/avatars/:avatar_id/assets/:asset_id/status', (req, res) => this.handleAssetStatus(req as Request<{ avatar_id: string, asset_id: string }>, res as Response));

        this.app.http.express.server.get('/api/avatars/:avatar_id/thumbnail', (req, res) => this.handleGetThumbnail(req as Request<{ avatar_id: string }>, res as Response));
        this.app.http.express.server.post('/api/avatars/:avatar_id/thumbnail', NetExpress.uploadTimeout(), this.app.http.express.upload.single('file'), NetExpress.handleMulterError(), (req: any, res: any) => this.handleUploadThumbnail(req as Request<{ avatar_id: string }>, res as Response));
    }

    /**
     * Calcule la prochaine date de retry (pour les requêtes de polling)
     */
    private static nextAt(): Date {
        const now = Date.now();
        return new Date(now + 5000); // Prochain retry dans 5 secondes
    }

    async handleNetAvatarAssets(request: Request<{ avatar_id: string }>, response: Response, avatarIdentifier: AvatarIdentifier) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.canFetchExternal())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'fetch external avatar assets'));
        const ns = await this.app.netServers.findOrInitServer(avatarIdentifier.server!);
        if (ns instanceof Error) {
            Debug.error(`Failed to find or init NetServer for ${avatarIdentifier.server}: ${ns.message}`);
            return response.send(new ErrorMessage(ErrorCodes.ServerNotFound));
        }
        const url = new URL(`/api/avatars/${avatarIdentifier.identifier}/assets`, `http://${ns.address}`);
        for (const [key, value] of Object.entries(request.query)) {
            if (typeof value === 'string') url.searchParams.set(key, value);
            else if (Array.isArray(value)) value.forEach(v => url.searchParams.append(key, v.toString()));
        }
        const res = await ns.fetch<any>(url, 'avatars/assets_response');
        if (res.error) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
        if (!res.data) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
        return response.send(res.data);
    }

    async handleAvatarAsset(request: Request<{ avatar_id: string }>, response: Response) {
        const avatarIdentifier = AvatarIdentifier.fromString(request.params.avatar_id);
        if (!avatarIdentifier)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));
        if (!avatarIdentifier.isLocal())
            return this.handleNetAvatarAssets(request, response, avatarIdentifier);
        let avatar_id = avatarIdentifier.identifier;
        let offset: number = typeof request.query.offset === 'string' && /^\d+$/.test(request.query.offset) ? parseInt(request.query.offset) : 0;
        let limit: number = typeof request.query.limit === 'string' && /^\d+$/.test(request.query.limit) ? parseInt(request.query.limit) : 10;
        let show_empty: boolean = request.query.hasOwnProperty('empty') && (request.query.empty === 'true' || request.query.empty === '');
        if (!AvatarManager.isValidAvatarId(avatar_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));
        if (offset < 0) offset = 0;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        let versions: number[] = [];
        let engines: string[] = [];
        let platforms: string[] = [];

        // Parse query parameters
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

        var result = await this.manager.findAvatarAssets(avatar_id, {
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
            assets: result.assets.map<IRAvatarAsset>(asset => ({
                id: asset.id,
                version: asset.version,
                engine: asset.engine,
                platform: asset.platform,
                is_empty: asset.isEmpty() || undefined,
                url: asset.isEmpty() ? null : (
                    asset.getURL()?.href || new URL(`/api/avatars/${avatar_id}/assets/${asset.id}/file`, this.app.server.getInfos().gateways.http)?.href
                ),
                features: asset.features,
                hash: asset.getHash() || null,
                size: asset.getSize() || null
            }))
        });
    }

    async handleDownloadAvatarAssetFile(request: Request<{ avatar_id: string, asset_id: string }>, response: Response) {
        let avatar_id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
        let asset_id: number = /^\d+$/.test(request.params.asset_id) ? parseInt(request.params.asset_id) : 0;

        if (!AvatarManager.isValidAvatarId(avatar_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));
        if (!AvatarManager.isValidAssetId(asset_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'asset_id', 'asset id'));

        let avatar = await this.manager.findAvatarById(avatar_id);
        if (!avatar)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));

        let asset = await this.manager.findAvatarAssetById(asset_id);
        if (!asset || asset.avatar_id !== avatar_id)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar Asset'));

        let file = asset.getFile();
        if (!file)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar Asset File'));

        // Vérifier si le fichier est compressé
        const isCompressed = file.endsWith('.gz');

        // Vérifier si le client accepte gzip
        const acceptEncoding = request.header('accept-encoding') || '';
        const clientAcceptsGzip = acceptEncoding.includes('gzip');

        if (isCompressed) {
            // Ajouter le hash dans les headers
            if (asset.hash) {
                response.set('X-File-Hash', asset.hash);
            }

            if (clientAcceptsGzip) {
                // Le client accepte gzip, envoyer le fichier compressé tel quel
                response.set('Content-Type', 'application/octet-stream');
                response.set('Content-Encoding', 'gzip');

                const fileStream = createReadStream(file);
                fileStream.pipe(response);

                fileStream.on('error', (error) => {
                    Debug.error('Stream error:', error);
                    if (!response.headersSent) {
                        response.status(500).send(new ErrorMessage(ErrorCodes.InternalError, 'stream file'));
                    }
                });
            } else {
                // Le client ne supporte pas gzip, décompresser à la volée
                response.set('Content-Type', 'application/octet-stream');
                // Pas de Content-Encoding car on décompresse

                const fileStream = createReadStream(file);
                const gunzip = createGunzip();

                fileStream.pipe(gunzip).pipe(response);

                fileStream.on('error', (error) => {
                    Debug.error('Stream error:', error);
                    if (!response.headersSent) {
                        response.status(500).send(new ErrorMessage(ErrorCodes.InternalError, 'stream file'));
                    }
                });

                gunzip.on('error', (error) => {
                    Debug.error('Gunzip error:', error);
                    if (!response.headersSent) {
                        response.status(500).send(new ErrorMessage(ErrorCodes.InternalError, 'decompress file'));
                    }
                });
            }
        } else {
            // Fichier non compressé, envoi direct
            if (asset.hash) {
                response.set('X-File-Hash', asset.hash);
            }
            response.sendFile(file);
        }
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
            if (!AvatarManager.isValidAvatarId(parseInt(id)))
                return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'id', 'search'));
            ids.push(id);
        } else if (Array.isArray(id))
            for (let i of id.map(i => i.toString())) {
                if (!AvatarManager.isValidAvatarId(parseInt(i)))
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'id', 'search'));
                ids.push(i);
            }

        let results: { avatars: Avatar[]; total: number; } = { avatars: [], total: 0 };
        if (ids.length > 0)
            results = await this.manager.searchAvatarsByIds(ids.map(id => parseInt(id)), ilimit, ioffset);
        else
            results = await this.manager.searchAvatars(querys || '', [], ilimit, ioffset);

        let address = this.app.server.getInfos().address;

        return response.send({
            total: results.total,
            search: query,
            ids: ids,
            avatars: await Promise.all(results.avatars.map<Promise<IRAvatar>>(async avatar => ({
                id: avatar.id,
                title: avatar.title || null,
                description: avatar.description || null,
                server: address,
                thumbnail: avatar.getThumbnail()?.href || null,
                tags: avatar.getTags(),
                alias: await avatar.alias(),
                owner: avatar.ownerIdentifier.toString(address),
            })))
        });
    }

    async handleCreateAvatar(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canCreateWorld()) // Using world permission for now
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'create avatars'));

        var data: IMakeAvatar = {
            id: request.body.id || undefined,
            title: request.body.title,
            description: request.body.description || undefined,
            thumbnail: request.body.thumbnail || undefined
        };

        Debug.log('create avatar', data, request.body);
        let avatar = await this.manager.createAvatar(data, user);

        if (avatar)
            return response.send<IRAvatar>({
                id: avatar.id,
                title: avatar.title || null,
                description: avatar.description || null,
                server: this.app.server.getInfos().address,
                thumbnail: avatar.getThumbnail()?.href || null,
                tags: avatar.getTags(),
                alias: await avatar.alias(),
                owner: avatar.ownerIdentifier.toString(this.app.server.getInfos().address),
            });

        return response.send(new ErrorMessage(ErrorCodes.InternalError, 'create avatar'));
    }

    async handleDeleteAvatar(request: Request<{ avatar_id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canDeleteWorld()) // Using world permission for now
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'delete avatars'));

        let id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
        let avatar = null;
        if (AvatarManager.isValidAvatarId(id))
            avatar = await this.manager.findAvatarById(id);
        if (!avatar)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
        if (!(await avatar.IsOwner(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'delete avatars'));

        await avatar.delete();
        return response.send({ success: true });
    }

    async handleUpdateAvatar(request: Request<{ avatar_id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canUpdateWorld()) // Using world permission for now
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update avatars'));

        let id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
        let avatar: Avatar | null = null;
        if (AvatarManager.isValidAvatarId(id))
            avatar = await this.manager.findAvatarById(id);
        if (!avatar)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
        if (!(await avatar.IsOwner(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update avatars'));

        let data = {
            title: request.body.title || undefined,
            description: request.body.description || undefined,
            thumbnail: request.body.thumbnail || undefined
        }

        Debug.log('update avatar', data);
        avatar.title = data.title || avatar.title;
        avatar.description = data.description || avatar.description;
        avatar.thumbnail = data.thumbnail || avatar.thumbnail;

        if (!await avatar.save())
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'update avatar'));

        return response.send<IRAvatar>({
            id: avatar.id,
            title: avatar.title || null,
            description: avatar.description || null,
            server: this.app.server.getInfos().address,
            thumbnail: avatar.getThumbnail()?.href || null,
            tags: avatar.getTags(),
            alias: await avatar.alias(),
            owner: avatar.ownerIdentifier.toString(this.app.server.getInfos().address),
        });
    }

    async handleNetAvatar(request: Request<{ avatar_id: string }>, response: Response, avatarIdentifier: AvatarIdentifier) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.canFetchExternal())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'fetch external avatar'));
        const ns = await this.app.netServers.findOrInitServer(avatarIdentifier.server!);
        if (ns instanceof Error) {
            Debug.error(`Failed to find or init NetServer for ${avatarIdentifier.server}: ${ns.message}`);
            return response.send(new ErrorMessage(ErrorCodes.ServerNotFound));
        }
        const url = new URL(`/api/avatars/${avatarIdentifier.identifier}`, `http://${ns.address}`);
        const res = await ns.fetch<IRAvatar>(url, 'avatars/info_response');
        if (res.error) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
        if (!res.data) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
        return response.send<IRAvatar>(res.data);
    }

    async handleAvatar(request: Request<{ avatar_id: string }>, response: Response) {
        const avatarIdentifier = AvatarIdentifier.fromString(request.params.avatar_id);
        if (!avatarIdentifier)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));
        if (!avatarIdentifier.isLocal())
            return this.handleNetAvatar(request, response, avatarIdentifier);
        let id = avatarIdentifier.identifier;
        if (!AvatarManager.isValidAvatarId(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));

        let avatar = await this.manager.findAvatarById(id);
        if (avatar) {
            return response.send<IRAvatar>({
                id: avatar.id,
                title: avatar.title || null,
                description: avatar.description || null,
                server: this.app.server.getInfos().address,
                thumbnail: avatar.getThumbnail()?.href || null,
                tags: avatar.getTags(),
                alias: await avatar.alias(),
                owner: avatar.ownerIdentifier.toString(this.app.server.getInfos().address),
            });
        }
        return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
    }

    async handleCreateAvatarAsset(request: Request<{ avatar_id: string }>, response: Response) {
        let id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
        if (!AvatarManager.isValidAvatarId(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canCreateWorldAsset()) // Using world asset permission for now
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'create avatar assets'));

        var data: IMakeAvatarAsset = {
            id: request.body.id || undefined,
            version: request.body.version,
            engine: request.body.engine,
            platform: request.body.platform,
            url: request.body.url || undefined,
            hash: request.body.hash || undefined,
            size: request.body.size || undefined,
            avatar_id: id
        };

        Debug.log('create avatar asset', data, request.body);
        data.avatar_id = id;
        const avatar = await this.manager.findAvatarById(id);
        if (!avatar)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
        if (!(await avatar.IsOwner(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'create avatar assets'));

        const check = await this.manager.findAvatarAssetByIndex(id, data.version, data.engine, data.platform);
        Debug.log('check', check, data);
        if (check)
            return response.send(new ErrorMessage(ErrorCodes.AlreadyExists, 'avatar asset', 'version, engine or platform'));

        Debug.log('create avatar asset', data);
        let asset = await this.manager.createAvatarAsset(data);

        if (asset)
            return response.send<IRAvatarAsset>({
                id: asset.id,
                version: asset.version,
                engine: asset.engine,
                platform: asset.platform,
                is_empty: asset.isEmpty() || undefined,
                url: asset.isEmpty() ? null : (
                    asset.getURL()?.href || new URL(`/api/avatars/${asset.avatar_id}/assets/${asset.id}/file`, this.app.server.getInfos().gateways.http)?.href
                ),
                features: asset.features,
                hash: asset.getHash() || null,
                size: asset.getSize() || null
            });

        return response.send(new ErrorMessage(ErrorCodes.InternalError, 'create avatar asset'));
    }

    /**
     * Upload d'un fichier d'asset d'avatar
     * Inspiré de la logique WorldAPIWeb mais avec processing asynchrone
     * 
     * Le fichier est d'abord validé (hash), puis ajouté à la queue de processing.
     * Le client reçoit immédiatement une réponse 202 Accepted avec l'état du job.
     * Le client peut ensuite interroger l'endpoint /status pour suivre la progression.
     */
    async handleUploadAvatarAssetFile(request: Request<{ avatar_id: string, asset_id: string }>, response: Response) {
        let avatar_id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
        let asset_id: number = /^\d+$/.test(request.params.asset_id) ? parseInt(request.params.asset_id) : 0;
        Debug.log('upload avatar asset file', avatar_id, asset_id, request.file);

        let file = request.file;
        if (!file)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file', 'file'));

        // Validation des IDs
        if (!AvatarManager.isValidAvatarId(avatar_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));
        if (!AvatarManager.isValidAssetId(asset_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'asset_id', 'asset id'));

        // Vérification de l'authentification
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canUploadWorldAssetFile()) // Using world asset permission for now
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'upload avatar assets'));

        // Vérification des permissions sur l'avatar
        const avatar = await this.manager.findAvatarById(avatar_id);
        if (!avatar)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
        if (!(await avatar.IsOwner(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'upload avatar assets'));

        // Vérification de l'asset
        let asset = await this.manager.findAvatarAssetById(asset_id);
        if (!asset || asset.avatar_id !== avatar_id)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar Asset'));

        // Calcul et vérification du hash (comme dans WorldAPIWeb)
        var hash = createHash('sha256').update(readFileSync(file.path)).digest('hex');
        var headerhash = request.header('x-file-hash');
        if (headerhash && headerhash !== hash)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file content', 'hash'));

        // Ajout à la queue de processing (traitement asynchrone)
        const job = processingQueue.addJob({
            context: {
                type: 'avatar',
                asset_id: asset.id,
                parent_id: avatar.id,
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
            next_at: AvatarAPIWeb.nextAt().getTime()
        });
    }

    /**
     * Récupère le statut du processing d'un asset
     * Permet au client de suivre la progression du traitement
     */
    async handleAssetStatus(request: Request<{ avatar_id: string, asset_id: string }>, response: Response) {
        let avatar_id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
        let asset_id: number = /^\d+$/.test(request.params.asset_id) ? parseInt(request.params.asset_id) : 0;

        if (!AvatarManager.isValidAvatarId(avatar_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));
        if (!AvatarManager.isValidAssetId(asset_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'asset_id', 'asset id'));

        // Vérifier que l'asset existe
        let asset = await this.manager.findAvatarAssetById(asset_id);
        if (!asset || asset.avatar_id !== avatar_id)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar Asset'));

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
                next_at: AvatarAPIWeb.nextAt().getTime()
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

    async handleGetThumbnail(request: Request<{ avatar_id: string }>, response: Response) {
        let avatar_id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
        if (!AvatarManager.isValidAvatarId(avatar_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));

        let avatar = await this.manager.findAvatarById(avatar_id);
        if (!avatar) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));

        return this.handleThumbnail({ avatar }, response);
    }

    async handleThumbnail({ avatar }: { avatar: Avatar }, response: Response) {
        if (!avatar) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));

        if (avatar.isLocalThumbnail()) {
            let path = avatar.getLocalThumbnailPath() as string;
            let [_, hash, type, ext] = basename(path).match(/^([0-9a-fA-F]+)-([a-zA-Z]+)\.([a-zA-Z]+)$/) || [];
            response.type(`image/${type}`);
            response.set('Content-Type', `image/${type}`);
            response.set('Content-Disposition', `inline; filename=thumbnail-${avatar.id}.${type}`);
            response.set('X-File-Hash', hash);
            return response.sendFile(path);
        }

        let thumbnail = avatar.getThumbnail();
        if (thumbnail) return response.redirect(thumbnail.href);

        return response.send(new ErrorMessage(ErrorCodes.NotFound, 'thumbnail'));
    }

    async handleUploadThumbnail(request: Request<{ avatar_id: string }>, response: Response) {
        let avatar_id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
        if (!AvatarManager.isValidAvatarId(avatar_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));

        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canUpdateWorld())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'upload avatar thumbnail'));

        let avatar = await this.manager.findAvatarById(avatar_id);
        if (!avatar)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
        if (!(await avatar.IsOwner(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'upload avatar thumbnail'));

        let file = request.file;
        if (!file)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file', 'file'));

        var hash = createHash('sha256').update(readFileSync(file.path)).digest('hex');
        var headerhash = request.header('x-file-hash');
        if (headerhash && headerhash !== hash)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file content', 'hash'));

        let thumbnail = avatar.setThumbnailFile(file, hash);
        if (!thumbnail)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'save thumbnail'));

        if (!await avatar.save())
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'update avatar'));

        return response.send({ success: true, thumbnail: avatar.getThumbnail()?.href });
    }
}

interface IRAvatar {
    id: number;
    title: string | null;
    description: string | null;
    server: string;
    thumbnail: string | null;
    tags: string[];
    alias: {
        key: string;
        value: string;
    }[]
    owner: string;
}

interface IRAvatarAsset {
    id: number;
    version: number;
    engine: string;
    platform: string;
    is_empty?: boolean;
    url: string | null;
    features: string[];
    hash: string | null;
    size: number | null;
}
