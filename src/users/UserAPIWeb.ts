import { createHash } from "node:crypto";
import Reileta from "../Main";
import NetExpress, { Request, Response } from "../network/NetExpress";
import UserRelation from "../relations/Relation";
import { ErrorCodes } from "../utils/Constants";
import { ErrorMessage, isValidURL, hash, verify } from "../utils/Utils";
import WorldIdentifier from "../worlds/WorldIdentifier";
import NetUser from "./NetUser";
import User from "./User";
import UserIdentifier from "./UserIdentifier";
import UserManager, { IUpdateUser } from "./UserManager";
import Express from 'express';
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import Session from "../auth/sessions/Session";
import { Security } from "../utils/Security";
import Debug from "../utils/Debug";
import AvatarIdentifier from "../avatars/AvatarIdentifier";
import { IUserLink } from "./User";
import { presenceToApi, presenceToDb } from "../utils/Presence";

export default class UserAPIWeb {
    constructor(private readonly app: Reileta, private readonly manager: UserManager) {
        this.app.http.express.server.get('/api/users', (req, res) => this.handleSearch(req as Request, res as Response));

        // Detail routes
        this.app.http.express.server.get('/api/users/@me', (req, res) => this.handleMe(req as Request, res as Response));
        this.app.http.express.server.post('/api/users/@me', Express.json(), NetExpress.validate<IUpdateUser>('users/update'), (req, res) => this.handleUpdateMe(req as Request, res as Response));
        this.app.http.express.server.get('/api/users/:search', (req, res) => this.handleUser(req as Request<{ search: string }>, res as Response));

        // Thumbnail routes
        this.app.http.express.server.get('/api/users/@me/thumbnail', (req, res) => this.handleGetMyThumbnail(req as Request, res as Response));
        this.app.http.express.server.get('/api/users/:search/thumbnail', (req, res) => this.handleGetThumbnail(req as Request<{ search: string }>, res as Response));
        this.app.http.express.server.post('/api/users/@me/thumbnail', NetExpress.uploadTimeout(), this.app.http.express.upload.single('file'), NetExpress.handleMulterError(), (req: any, res: any) => this.handleUploadThumbnail(req as Request, res as Response));

        // Banner routes
        this.app.http.express.server.get('/api/users/@me/banner', (req, res) => this.handleGetMyBanner(req as Request, res as Response));
        this.app.http.express.server.get('/api/users/:search/banner', (req, res) => this.handleGetBanner(req as Request<{ search: string }>, res as Response));
        this.app.http.express.server.post('/api/users/@me/banner', NetExpress.uploadTimeout(), this.app.http.express.upload.single('file'), NetExpress.handleMulterError(), (req: any, res: any) => this.handleUploadBanner(req as Request, res as Response));

        // Sessions routes
        this.app.http.express.server.get('/api/users/@me/sessions', (req, res) => this.handleMySessions(req as Request, res as Response));

        // Public elements (is a variant of tables but for public access like public.:type)
        this.app.http.express.server.get('/api/users/@me/public/:type', (req, res) => this.handleGetMyPublicElement(req as Request<{ type: string }>, res as Response));
        this.app.http.express.server.get('/api/users/:search/public/:type', (req, res) => this.handleGetUserPublicElement(req as Request<{ search: string, type: string }>, res as Response));
    }


    async handleMySessions(request: Request, response: Response) {
        var { query, limit, offset, id } = request.query;
        if (!limit || typeof limit !== 'string' || !/^\d+$/.test(limit)) limit = '10';
        if (!offset || typeof offset !== 'string' || !/^\d+$/.test(offset)) offset = '0';
        var ilimit = parseInt(limit);
        var ioffset = parseInt(offset);
        if (ilimit > 100) ilimit = 100;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;

        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        let results: { sessions: Session[]; total: number; } = { sessions: [], total: 0 };

        results = await this.app.sessions.findSessionsByUserId({
            user_id: user.id,
            limit: ilimit,
            offset: ioffset
        });
        return response.send<IRSessionList>({
            total: results.total,
            limit: ilimit,
            offset: ioffset,
            sessions: results.sessions.map<IRSession>(s => ({
                id: s.id,
                expires: s.expires.getTime(),
                created_at: s.created_at.getTime(),
                updated_at: s.updated_at.getTime()
            }))
        });
    }

    async handleGetMyBanner(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        return this.handleBanner({ user }, response);
    }

    async handleGetBanner(request: Request<{ search: string, type?: string }>, response: Response) {
        let user: User | null = null;
        if (/^\d+$/.test(request.params.search) && UserManager.isValidId(parseInt(request.params.search)))
            user = await this.manager.findUserById(parseInt(request.params.search));
        else user = await this.manager.findUserByUsername(request.params.search);

        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        return this.handleBanner({ user }, response);
    }

    async handleBanner({ user }: { user: User }, response: Response) {
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        if (user.isLocalBanner()) {
            let path = user.getLocalBannerPath() as string;
            let [_, hash, type, ext] = basename(path).match(/^([0-9a-fA-F]+)-([a-zA-Z]+)\.([a-zA-Z]+)$/) || [];
            response.type(`image/${type}`);
            response.set('Content-Type', `image/${type}`);
            response.set('Content-Disposition', `inline; filename=banner-${user.id}.${type}`);
            response.set('X-File-Hash', hash);
            return response.sendFile(path);
        }

        let banner = user.getBanner(this.app.server.getInfos().gateways.http);
        if (banner) return response.redirect(banner.href);

        return response.send(new ErrorMessage(ErrorCodes.NotFound, 'banner'));
    }

    async handleUploadBanner(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        // get user
        let user = await request.data.getData() as User | null;
        if (!user || !user.canUpdateUser() || !user.canUploadFile())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update user'));

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
        let banner = user.setBannerFile(file, hash);
        if (!banner) return response.send(new ErrorMessage(ErrorCodes.InternalError, 'upload banner'));

        // update user
        user = await user.update();
        if (!user) return response.send(new ErrorMessage(ErrorCodes.InternalError, 'update user'));

        // send response like GET
        return this.handleBanner({ user }, response);
    }

    async handleGetMyThumbnail(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        return this.handleThumbnail({ user }, response);
    }

    async handleGetThumbnail(request: Request<{ search: string, type?: string }>, response: Response) {
        let user: User | null = null;
        if (/^\d+$/.test(request.params.search) && UserManager.isValidId(parseInt(request.params.search)))
            user = await this.manager.findUserById(parseInt(request.params.search));
        else user = await this.manager.findUserByUsername(request.params.search);

        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        return this.handleThumbnail({ user }, response);
    }

    async handleThumbnail({ user }: { user: User }, response: Response) {
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        if (user.isLocalThumbnail()) {
            let path = user.getLocalThumbnailPath() as string;
            let [_, hash, type, ext] = basename(path).match(/^([0-9a-fA-F]+)-([a-zA-Z]+)\.([a-zA-Z]+)$/) || [];
            response.type(`image/${type}`);
            response.set('Content-Type', `image/${type}`);
            response.set('Content-Disposition', `inline; filename=thumbnail-${user.id}.${type}`);
            response.set('X-File-Hash', hash);
            return response.sendFile(path);
        }

        let thumbnail = user.getThumbnail(this.app.server.getInfos().gateways.http);
        if (thumbnail) return response.redirect(thumbnail.href);

        return response.send(new ErrorMessage(ErrorCodes.NotFound, 'thumbnail'));
    }

    async handleUploadThumbnail(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        // get user
        let user = await request.data.getData() as User | null;
        if (!user || !user.canUpdateUser() || !user.canUploadFile())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update user'));

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
        let thumbnail = user.setThumbnailFile(file, hash);
        if (!thumbnail) return response.send(new ErrorMessage(ErrorCodes.InternalError, 'upload thumbnail'));

        // update user
        user = await user.update();
        if (!user) return response.send(new ErrorMessage(ErrorCodes.InternalError, 'update user'));

        // send response like GET
        return this.handleThumbnail({ user }, response);
    }

    async handleSearch(request: Request, response: Response) {
        var { query, limit, offset, id } = request.query;
        if (!limit || typeof limit !== 'string' || !/^\d+$/.test(limit)) limit = '10';
        if (!offset || typeof offset !== 'string' || !/^\d+$/.test(offset)) offset = '0';
        var ilimit = parseInt(limit);
        var ioffset = parseInt(offset);
        if (ilimit > 100) ilimit = 100;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;

        let querys: string | undefined = typeof query === 'string' && query.length > 0 ? query : undefined;
        let users: UserIdentifier[] | undefined = undefined;
        if (typeof id === 'string')
            users = [UserIdentifier.fromString(id.toString()) || undefined];
        else if (Array.isArray(id))
            users = id.map(x => UserIdentifier.fromString(x.toString()) || undefined);

        let results: { users: User[]; total: number; } = { users: [], total: 0 };

        if (users && users.length > 0)
            results = await this.manager.searchUsers({
                users: users
            }, ilimit, ioffset);
        else if (querys)
            results = await this.manager.searchUsers({
                query: querys,
            }, ilimit, ioffset);


        let address = this.app.server.getInfos().address;
        let http = this.app.server.getInfos().gateways.http;
        let web = this.app.server.getInfos().gateways.web;

        let me = request.data.isBearer() ? (await request.data.getData() as User | null) : null;

        let us: IRUser[] = [];
        for (var user of results.users) {
            let outRelation: UserRelation | null = null;
            let inRelation: UserRelation | null = null;

            if (request.data.isBearer() && me) {
                outRelation = await this.app.relations.getRelation(me, user);
                inRelation = await this.app.relations.getRelation(user, me);
            }

            us.push({
                id: user.id,
                username: user.username,
                display: user.display,
                server: address,
                bio: user.bio,
                pronoun: user.pronoun,
                tags: user.getTags(),
                thumbnail: user.getThumbnail(http)?.href || null,
                banner: user.getBanner(http)?.href || null,
                links: user.getLinks(),
                relations: {
                    in: inRelation?.type || null,
                    out: outRelation?.type || null
                },
                rank: user.rank,
                certificate: Security.compactCertificate(Security.certificateToPem(user.publicCertificate)),
                followers: await user.getFollowersCount(),
                following: await user.getFollowingCount(),
                alias: await user.alias(),
            });
        }

        return response.send({
            total: results.total,
            query: query,
            ids: users?.map(x => x?.toString(address)) || [],
            limit: ilimit,
            offset: ioffset,
            users: us
        });
    }

    async handleMe(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        let address = this.app.server.getInfos().address;
        let http = this.app.server.getInfos().gateways.http;
        let web = this.app.server.getInfos().gateways.web;

        return response.send<IRUserMe>({
            id: user.id,
            username: user.username,
            display: user.display,
            bio: user.bio || null,
            pronoun: user.pronoun,
            server: address,
            tags: user.getTags(),
            thumbnail: user.getThumbnail(http)?.href || null,
            banner: user.getBanner(http)?.href || null,
            home: user.getHomeRef()?.toString(address) || null,
            avatar: user.getAvatarRef()?.toString(address) || null,
            links: user.getLinks(),
            rank: user.rank,
            email: user.email || null,
            email_verified: user.email_verified,
            relations: null,
            created_at: user.created_at.getTime(),
            twofa_enabled: user.twofa_enabled,
            certificate: Security.compactCertificate(Security.certificateToPem(user.publicCertificate)),
            followers: await user.getFollowersCount(),
            following: await user.getFollowingCount(),
            presence: {
                status: presenceToApi(user.presence),
                text: user.presence_status,
            },
            alias: await user.alias(),
        });
    }

    async handleNetUser(request: Request<{ search: string }>, response: Response) {

        let userIdentifier = UserIdentifier.fromString(request.params.search);
        if (userIdentifier.isLocal() || !userIdentifier.server)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        // get user
        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        if (!user.canFetchExternal())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'fetch external user'));

        let ns = await this.app.netServers.findOrInitServer(userIdentifier.server);
        if (ns instanceof Error) {
            Debug.error(`Failed to find or init NetServer for ${userIdentifier.server}: ${ns.message}`);
            return response.send(new ErrorMessage(ErrorCodes.ServerNotFound));
        }

        let nu = await this.app.netUsers.findOrFetch(userIdentifier.identifier, ns);
        if (!nu) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        let infos = await nu.fetchUser();
        if (!infos) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        // Handle both old format (presence as string) and new format (presence as object)
        let presence: IPresence | undefined;
        if (infos.presence) {
            if (typeof infos.presence === 'object' && 'status' in infos.presence) {
                // New format
                presence = {
                    status: String(infos.presence.status).toLowerCase(),
                    text: infos.presence.text ?? null,
                };
            } else {
                // Old format - presence is a string, presence_status is the text
                presence = {
                    status: String(infos.presence).toLowerCase(),
                    text: (infos as any).presence_status ?? null,
                };
            }
        }

        return response.send<IRUser>({
            id: infos.id,
            username: infos.username,
            display: infos.display,
            server: userIdentifier.server,
            tags: infos.tags,
            bio: infos.bio,
            pronoun: infos.pronoun,
            thumbnail: infos.thumbnail,
            banner: infos.banner,
            links: infos.links,
            relations: null,
            rank: infos.rank,
            certificate: infos.certificate,
            followers: infos.followers || 0,
            following: infos.following || 0,
            presence,
            alias: infos.alias || [],
        });
    }

    async handleUser(request: Request<{ search: string }>, response: Response) {
        let user: User | null = null;


        let userIdentifier = UserIdentifier.fromString(request.params.search);
        if (!userIdentifier.isLocal())
            return this.handleNetUser(request, response);

        if (!userIdentifier.isUsername())
            user = await this.manager.findUserById(userIdentifier.identifierAsId());
        else user = await this.manager.findUserByUsername(userIdentifier.identifierAsUsername());

        let fingerprint = request.query.fp?.toString();
        if (fingerprint && user && !await user.hasFingerprint(fingerprint)) {
            Debug.log(`Fingerprint mismatch for user ${user.id} (${user.username}) when fetching user info`);
            user = null;
        }

        let outRelation: UserRelation | null = null;
        let inRelation: UserRelation | null = null;

        if (request.data.isBearer()) {
            let me = await request.data.getData() as User | null;
            if (me && user) {
                outRelation = await this.app.relations.getRelation(me, user);
                inRelation = await this.app.relations.getRelation(user, me);
            }
        }

        if (user) {
            let address = this.app.server.getInfos().address;
            let http = this.app.server.getInfos().gateways.http;
            let web = this.app.server.getInfos().gateways.web;
            return response.send<IRUser>({
                id: user.id,
                username: user.username,
                display: user.display,
                bio: user.bio || null,
                pronoun: user.pronoun,
                server: address,
                tags: user.getTags(),
                thumbnail: user.getThumbnail(http)?.href || null,
                banner: user.getBanner(http)?.href || null,
                links: user.getLinks(),
                relations: {
                    out: outRelation?.type || null,
                    in: inRelation?.type || null
                },
                rank: user.rank,
                certificate: Security.compactCertificate(Security.certificateToPem(user.publicCertificate)),
                followers: await user.getFollowersCount(),
                following: await user.getFollowingCount(),
                presence: {
                    status: presenceToApi(user.presence),
                    text: user.presence_status,
                },
                alias: await user.alias(),
            });
        }
        return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
    }

    async handleUpdateMe(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        let user = await request.data.getData() as User | null;
        if (!user || !user.canUpdateUser())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'update user'));

        let input = request.body as IUpdateUser;
        let sensitive = false;


        if (input.username && input.username !== user.username) {
            if (await this.manager.findUserByUsername(input.username))
                return response.send(new ErrorMessage(ErrorCodes.AlreadyExists, 'User', 'username'));
            user.username = input.username;
            sensitive = true;
        }

        if (input.home) {
            var wi = WorldIdentifier.fromString(input.home);
            if (!wi) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'home', 'WorldIdentifier'));
            if (wi.server === this.app.server.getInfos().address) wi.server = undefined;
            input.home = wi.toString();
        } else if (!input.home && input.home !== null)
            input.home = undefined;

        if (input.avatar) {
            var wi = AvatarIdentifier.fromString(input.avatar);
            if (!wi) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'avatar', 'AvatarIdentifier'));
            if (wi.server === this.app.server.getInfos().address) wi.server = undefined;
            input.avatar = wi.toString();
        } else if (!input.avatar && input.avatar !== null)
            input.avatar = undefined;

        if (input.email && input.email !== user.email) {
            // Check if the new email is already used by another user
            const existingUser = await this.manager.findUserByEmail(input.email);
            if (existingUser && existingUser.id !== user.id)
                return response.send(new ErrorMessage(ErrorCodes.AlreadyExists, 'User', 'email'));
            sensitive = true;
        }

        if (input.tags) {
            const newUsrTags = input.tags.reduce<string[]>((acc, tag) => {
                if (!acc.includes(tag)) acc.push(tag);
                return acc;
            }, []).filter(t => t.startsWith('usr:') && t.split(':')[1].length > 0);
            const nonUsrTags = user.tags.filter(tag => !tag.startsWith('usr:'));
            input.tags = [...newUsrTags, ...nonUsrTags];
        }

        if (input.links) {
            for (let i = 0; i < input.links.length; i++) {
                const link = input.links[i];
                link.label = link.label.trim();
                link.value = link.value.trim();
            }
        }

        if (input.password) {
            if (!input.current_password)
                return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'current_password', 'Current password is required to change password'));

            if (!user.password || !verify(input.current_password, user.password))
                return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'current_password', 'Current password is incorrect'));

            user.password = hash(input.password);
            sensitive = true;
        }

        const emailChanged = input.email && input.email !== user.email;
        if (emailChanged) {
            user.email = input.email || null;
            user.email_verified = false;
        }

        user.bio = input.bio || user.bio;
        user.pronoun = input.pronoun !== undefined ? input.pronoun : user.pronoun;
        user.links = input.links ? (input.links as any) : user.links;
        user.tags = input.tags || user.tags;
        user.thumbnail = input.thumbnail || user.thumbnail;
        user.banner = input.banner || user.banner;
        user.home_ref = input.home !== null
            ? (input.home
                ? input.home
                : user.home_ref
            ) : null;
        user.avatar_ref = input.avatar !== null
            ? (input.avatar
                ? input.avatar
                : user.avatar_ref
            ) : null;
        user.display = input.display || user.display;

        // Update presence (convert API status to DB enum)
        if (input.presence !== undefined) {
            user.presence = presenceToDb(input.presence);
        }
        if (input.presence_status !== undefined) {
            const trimmed = input.presence_status?.trim() || null;
            user.presence_status = trimmed === '' ? null : trimmed;
        }

        if (sensitive && this.app.auth.verification.isVerificationRequired(user)) {

            if (input.factor_code) {
                const verifyResult = await this.app.auth.verification.verifyFactorCode(user, input.factor_code);
                if (!verifyResult.success)
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, "factor_code", verifyResult.message));
                // Verification successful, proceed with the update
            } else {
                // No factor code provided, return verification required
                let err = new ErrorMessage(ErrorCodes.VerificationRequired, "Verification required");
                err.data = { methods: this.app.auth.verification.getAvailableVerificationMethods(user) };
                return response.send(err);
            }
        }

        user = await user.update();
        if (!user) return response.send(new ErrorMessage(ErrorCodes.InternalError, 'update user'));

        // Send email verification if email was changed
        if (emailChanged && user.email) {
            try {
                await this.app.emails.verification.sendVerificationEmail(user);
            } catch (error) {
                Debug.error('Failed to send email verification:', error);
                // Don't fail the user update, but log the error
            }
        }

        let address = this.app.server.getInfos().address;
        let http = this.app.server.getInfos().gateways.http;
        let web = this.app.server.getInfos().gateways.web;

        let output: IRUserMe = {
            id: user.id,
            username: user.username,
            display: user.display,
            bio: user.bio || null,
            pronoun: user.pronoun,
            server: address,
            tags: user.getTags(),
            thumbnail: user.getThumbnail(http)?.href || null,
            banner: user.getBanner(http)?.href || null,
            home: user.getHomeRef()?.toString(address) || null,
            avatar: user.getAvatarRef()?.toString(address) || null,
            links: user.getLinks(),
            rank: user.rank,
            email: user.email || null,
            email_verified: user.email_verified,
            relations: null,
            created_at: user.created_at.getTime(),
            twofa_enabled: user.twofa_enabled,
            certificate: Security.compactCertificate(Security.certificateToPem(user.publicCertificate)),
            followers: await user.getFollowersCount(),
            following: await user.getFollowingCount(),
            presence: {
                status: presenceToApi(user.presence),
                text: user.presence_status,
            },
            alias: await user.alias(),
        }

        let socket = await user.getSockets();
        for (let s of socket) s.emitData('user_update', output);
        return response.send(output);
    }


    private tableToPublicElement(type: string) {
        // Map table types to public element types if needed
        return `public.${type}`;
    }

    async handleGetMyPublicElement(request: Request<{ type: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        var table = await this.app.tables.findTableByKeyAndUser(this.tableToPublicElement(request.params.type), user.id);
        if (!table) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'public element'));

        // check Accept is compatible
        let accept = request.header('accept');
        if (accept && table.mime && accept !== '*/*' && accept !== table.mime)
            return response.send(new ErrorMessage(ErrorCodes.NotAcceptable, 'MIME type not acceptable'));

        return response
            .contentType(table.mime || 'application/octet-stream')
            .send({
                key: table.key,
                value: table.value,
                updated_at: table.updated_at.getTime(),
            });
    }

    async handleGetUserPublicElement(request: Request<{ search: string, type: string }>, response: Response) {
        let user: User | null = null;
        if (/^\d+$/.test(request.params.search) && UserManager.isValidId(parseInt(request.params.search)))
            user = await this.manager.findUserById(parseInt(request.params.search));
        else user = await this.manager.findUserByUsername(request.params.search);

        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        var table = await this.app.tables.findTableByKeyAndUser(this.tableToPublicElement(request.params.type), user.id);
        if (!table) return response.send(new ErrorMessage(ErrorCodes.NotFound, 'public element'));
        // check Accept is compatible
        let accept = request.header('accept');
        if (accept && table.mime && accept !== '*/*' && accept !== table.mime)
            return response.send(new ErrorMessage(ErrorCodes.NotAcceptable, 'MIME type not acceptable'));

        return response
            .contentType(table.mime || 'application/octet-stream')
            .send({
                key: table.key,
                value: table.value,
                updated_at: table.updated_at.getTime(),
            });
    }
}

export interface IRSessionList {
    total: number;
    limit: number;
    offset: number;
    sessions: IRSession[];
}

export interface IRSession {
    expires: number;
    created_at: number;
}


export interface IPresence {
    status: string;
    text: string | null;
}

export interface IRUser {
    id: number;
    username: string;
    display: string;
    server: string;
    tags: string[];
    bio: string | null;
    thumbnail: string | null;
    banner: string | null;
    pronoun: string | null;
    links: IUserLink[];
    rank: number;
    relations: {
        out: string | null;
        in: string | null;
    } | null
    certificate: string;
    followers: number;
    following: number;
    presence?: IPresence;
    alias: {
        key: string;
        value: string;
    }[];
}

export interface IRAvatar {
    id: number;
    title: string;
    description: string | null;
    server: string;
    thumbnail: string | null;
    tags: string[];
    owner: string;
}

export interface IRUserMe extends IRUser {
    email: string | null;
    email_verified: boolean;
    created_at: number;
    home: string | null;
    avatar: string | null;
    relations: null;
    twofa_enabled: boolean;
    presence: IPresence;
}
