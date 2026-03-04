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
import Avatar from './Avatar';
import Debug from '../utils/Debug';
import processingQueue, { ProcessingStatus } from './AssetProcessingQueue';

export interface ProcessingJobResponse {
    status: ProcessingStatus | 'empty';
    hash?: string;
    size?: number;
    progress: number;
    message: string;
    queue_position?: number;
    error?: string;
    created_at: number;
    started_at?: number;
    completed_at?: number;
    next_at?: number;
}


export default class AvatarAPIWeb {
    constructor(private readonly app: Reileta, private readonly manager: AvatarManager) {
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

        // Setup processing queue handler
        this.setupProcessingQueue();
    }

    private static nextAt() {
        const now = Date.now();
        return new Date(now + 5000); // Next retry in 5 seconds
    }

    private setupProcessingQueue() {
        processingQueue.on('process', async (job) => {
            try {
                const asset = await this.manager.findAvatarAssetById(job.asset_id);
                if (!asset) {
                    processingQueue.completeJob(job.asset_id, false, 'Asset not found');
                    return;
                }

                // Update progress: validating
                processingQueue.updateProgress(job.asset_id, 20, ProcessingStatus.VALIDATING);

                const { sucess, data } = await checkValidAssetFile(job.file_path, asset.engine, asset.platform, 'avatar');
                if (!sucess || !data || typeof data === 'string') {
                    processingQueue.completeJob(job.asset_id, false,
                        data && typeof data === 'string' ? data : 'Validation failed');
                    return;
                }

                // Update progress: setting features
                processingQueue.updateProgress(job.asset_id, 40);
                if (!asset.setFeatures([])) {
                    processingQueue.completeJob(job.asset_id, false, 'Failed to set features');
                    return;
                }

                // Update progress: saving file
                processingQueue.updateProgress(job.asset_id, 60, ProcessingStatus.COMPRESSING);

                // Use async file operation with compression
                const fileObj: any = { path: job.file_path, size: statSync(job.file_path).size };
                const success = await asset.setFileAsync(fileObj, job.hash);

                if (!success) {
                    processingQueue.completeJob(job.asset_id, false, 'Failed to save file');
                    return;
                }

                // Update progress: updating database
                processingQueue.updateProgress(job.asset_id, 80);
                const updatedAsset = await this.manager.updateAvatarAsset(asset);

                if (!updatedAsset) {
                    processingQueue.completeJob(job.asset_id, false, 'Failed to update database');
                    return;
                }

                // Complete
                processingQueue.completeJob(job.asset_id, true);
            } catch (error) {
                Debug.error('Processing queue error:', error);
                processingQueue.completeJob(job.asset_id, false,
                    error instanceof Error ? error.message : String(error));
            }
        });
    }

    async handleAvatarAsset(request: Request<{ avatar_id: string }>, response: Response) {
        let avatar_id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
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
                    asset.getURL()?.href || new URL(`/api/avatars/${asset.avatar_id}/assets/${asset.id}/file`, this.app.server.getInfos().gateways.http)?.href
                ),
                features: asset.features,
                hash: asset.getHash() || null,
                size: asset.getSize() || null
            }))
        });
    }

    async searchHandler(request: Request, response: Response) {
        let query: string = typeof request.query.search === 'string' ? request.query.search : '';
        let tags: string[] = [];
        let ids: number[] = [];
        let ilimit: number = typeof request.query.limit === 'string' && /^\d+$/.test(request.query.limit) ? parseInt(request.query.limit) : 10;
        let ioffset: number = typeof request.query.offset === 'string' && /^\d+$/.test(request.query.offset) ? parseInt(request.query.offset) : 0;
        if (typeof request.query.tags === 'string' && request.query.tags.length > 0)
            tags = request.query.tags.split(',');
        else if (Array.isArray(request.query.tags))
            tags = request.query.tags.map(tag => tag.toString());
        if (typeof request.query.ids === 'string' && request.query.ids.length > 0) {
            let selector = AvatarManager.getAvatarSelector(request.query.ids);
            if (selector) ids = selector.ids;
        }
        if (ilimit > 100) ilimit = 100;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;
        var results = ids.length > 0 ?
            await this.manager.searchAvatarsByIds(ids, ilimit, ioffset) :
            await this.manager.searchAvatars(query, tags, ilimit, ioffset);
        return response.send({
            total: results.total,
            search: query,
            ids: ids,
            limit: ilimit,
            offset: ioffset,
            avatars: results.avatars.map<IRAvatar>(avatar => ({
                id: avatar.id,
                title: avatar.title,
                description: avatar.description,
                server: this.app.server.getInfos().address,
                tags: avatar.getTags(),
                owner: avatar.ownerIdentifier.toString(this.app.server.getInfos().address),
                thumbnail: avatar.getThumbnail()?.href || null,
            }))
        });
    }

    async handleCreateAvatar(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canCreateWorld()) // Using world permission for now
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'create avatars'));

        let data: IMakeAvatar = {
            id: request.body.id || undefined,
            title: request.body.title || undefined,
            description: request.body.description || undefined,
            thumbnail: request.body.thumbnail || undefined
        };

        if (request.body.id > 0 && await this.manager.findAvatarById(request.body.id))
            return response.send(new ErrorMessage(ErrorCodes.AlreadyExists, 'avatar'));
        let avatar = await this.manager.createAvatar(request.body, user);
        if (!avatar)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'create avatar'));
        if (!(await avatar.IsOwner(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'create avatars (owner)'));

        return response.send<IRAvatar>({
            id: avatar.id,
            title: avatar.title || null,
            description: avatar.description || null,
            server: this.app.server.getInfos().address,
            thumbnail: avatar.getThumbnail()?.href || null,
            tags: avatar.getTags(),
            owner: avatar.ownerIdentifier.toString(this.app.server.getInfos().address),
        });
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
            owner: avatar.ownerIdentifier.toString(this.app.server.getInfos().address),
        });
    }

    async handleAvatar(request: Request<{ avatar_id: string }>, response: Response) {
        let id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
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
                    asset.getURL()?.href || new URL(`/api/worlds/${asset.avatar_id}/assets/${asset.id}/file`, this.app.server.getInfos().gateways.http)?.href
                ),
                features: asset.features,
                hash: asset.getHash() || null,
                size: asset.getSize() || null
            });
        return response.send(new ErrorMessage(ErrorCodes.InternalError, 'create avatar asset'));
    }

    async handleUploadAvatarAssetFile(request: Request<{ avatar_id: string, asset_id: string }>, response: Response) {
        let avatar_id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
        let asset_id: number = /^\d+$/.test(request.params.asset_id) ? parseInt(request.params.asset_id) : 0;
        Debug.log('upload avatar asset file', avatar_id, asset_id, request.file);

        let file = request.file;
        if (!file)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file', 'file'));

        if (!AvatarManager.isValidAvatarId(avatar_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));
        if (!AvatarManager.isValidAssetId(asset_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'asset_id', 'asset id'));

        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user || !user.canUploadWorldAssetFile()) // Using world asset permission for now
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'upload avatar assets'));

        const avatar = await this.manager.findAvatarById(avatar_id);
        if (!avatar)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));
        if (!(await avatar.IsOwner(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'upload avatar assets'));
        let asset = await this.manager.findAvatarAssetById(asset_id);
        if (!asset || asset.avatar_id !== avatar_id)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar Asset'));

        // Calculate hash
        var hash = createHash('sha256').update(readFileSync(file.path)).digest('hex');
        var headerhash = request.header('x-file-hash');
        if (headerhash && headerhash !== hash)
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'file content', 'hash'));

        // Add to processing queue
        const job = processingQueue.addJob({
            asset_id: asset.id,
            avatar_id: avatar.id,
            file_path: file.path,
            hash: hash
        });

        // Return immediately with accepted status
        return response.status(202).send<ProcessingJobResponse>({
            message: 'Asset queued for processing',
            status: job.status,
            progress: job.progress,
            queue_position: processingQueue.getQueueLength(),
            created_at: job.created_at.getTime(),
            started_at: job.started_at?.getTime(),
            next_at: AvatarAPIWeb.nextAt().getTime()
        });
    }

    async handleAssetStatus(request: Request<{ avatar_id: string, asset_id: string }>, response: Response) {
        let avatar_id: number = /^\d+$/.test(request.params.avatar_id) ? parseInt(request.params.avatar_id) : 0;
        let asset_id: number = /^\d+$/.test(request.params.asset_id) ? parseInt(request.params.asset_id) : 0;

        if (!AvatarManager.isValidAvatarId(avatar_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar_id', 'avatar id'));
        if (!AvatarManager.isValidAssetId(asset_id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'asset_id', 'asset id'));

        // Check if asset exists
        let asset = await this.manager.findAvatarAssetById(asset_id);
        if (!asset || asset.avatar_id !== avatar_id)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar Asset'));

        // Check processing queue
        const job = processingQueue.getJob(asset_id);

        if (job)
            return response.send<ProcessingJobResponse>({
                status: job.status,
                progress: job.progress,
                error: job.error,
                message: (() => {
                    switch (job.status) {
                        case ProcessingStatus.PENDING:
                            return `Processing pending`;
                        case ProcessingStatus.COMPLETED:
                            return 'Processing completed';
                        case ProcessingStatus.FAILED:
                            return 'Processing failed';
                        case ProcessingStatus.VALIDATING:
                            return 'Validating asset file';
                        case ProcessingStatus.COMPRESSING:
                            return 'Compressing asset file';
                        case ProcessingStatus.PROCESSING:
                            return 'Processing asset file';
                        default:
                            return 'Processing status unknown';
                    }
                })(),
                queue_position: job.status === ProcessingStatus.PENDING ? processingQueue.getQueueLength() : 0,
                started_at: job.started_at?.getTime(),
                created_at: job.created_at.getTime(),
                completed_at: job.completed_at?.getTime(),
                next_at: job.status !== ProcessingStatus.COMPLETED && job.status !== ProcessingStatus.FAILED
                    ? AvatarAPIWeb.nextAt().getTime()
                    : undefined
            });

        // If not in queue, check asset state
        if (asset.isEmpty())
            return response.send<ProcessingJobResponse>({
                status: 'empty',
                progress: 0,
                message: 'Asset has no file uploaded yet',
                created_at: Date.now(),
            });

        return response.send<ProcessingJobResponse>({
            status: ProcessingStatus.COMPLETED,
            progress: 100,
            message: 'Asset processing completed',
            created_at: Date.now(),
            hash: asset.hash!,
            size: asset.size
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

        // Check if file is compressed
        const isCompressed = file.endsWith('.gz');

        if (isCompressed) {
            // Stream with decompression
            response.set('Content-Type', 'application/octet-stream');
            response.set('Content-Encoding', 'gzip');
            response.set('X-File-Hash', asset.hash || '');

            const fileStream = createReadStream(file);
            fileStream.pipe(response);

            fileStream.on('error', (error) => {
                Debug.error('Stream error:', error);
                if (!response.headersSent) {
                    response.status(500).send(new ErrorMessage(ErrorCodes.InternalError, 'stream file'));
                }
            });
        } else {
            // Regular file send with streaming support
            response.set('X-File-Hash', asset.hash || '');
            response.sendFile(file);
        }
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

        // get user
        let user = await request.data.getData() as User | null;
        if (!user || !user.canUpdateWorld() || !user.canUploadFile()) // Using world permission for now
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update avatar'));

        let avatar = await this.manager.findAvatarById(avatar_id);
        if (!avatar) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Avatar'));

        if (!(await avatar.IsOwner(user)))
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update avatar'));

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
        let thumbnail = avatar.setThumbnailFile(file, hash);
        if (!thumbnail) return response.send(new ErrorMessage(ErrorCodes.InternalError, 'upload thumbnail'));

        // update avatar
        if (!await avatar.save()) return response.send(new ErrorMessage(ErrorCodes.InternalError, 'update avatar'));

        // send response like GET
        return this.handleThumbnail({ avatar }, response);
    }
}

export interface IRAvatar {
    id: number;
    title: string | null;
    description: string | null;
    tags: string[];
    thumbnail: string | null;
    owner: string;
    server: string;
}

export interface IRAvatarAsset {
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
