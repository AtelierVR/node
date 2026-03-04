import EventEmitter from "events";
import NetHTTP from "./network/NetHTTP";
import { ServerManager } from "./server/ServerManager";
import UserManager from "./users/UserManager";
import InstanceManager from "./instances/InstanceManager";
import SessionManager from "./auth/sessions/SessionManager";
import AuthManager from "./auth/AuthManager";
import RelayManager from "./relay/RelayManager";
import BadgerManager from "./auth/badgers/BadgerManager";
import WorldManager from "./worlds/WorldManager";
import AvatarManager from "./avatars/AvatarManager";
import Debug from "./utils/Debug";
import { sleep } from "./utils/Utils";
import NetServerManager from "./server/NetServerManager";
import NetUserManager from "./users/NetUserManager";
import NetServer from "./server/NetServer";
import DockerManager from "./relay/runtime/DockerManager";
import NotificationManager from "./notifications/NotificationManager";
import PresenceManager from "./presence/PresenceManager";
import RelationManager from "./relations/RelationManager";
import DeviceManager from "./auth/devices/DeviceManager";
import Database from "./Database";
import EmailManager from "./email/EmailManager";
import TwoFactorManager from "./totp/TwoFactorManager";
import TableManager from "./tables/TableManager";
import MessageManager from "./messages/MessageManager";
import ConversationManager from "./messages/ConversationManager";
import ConversationReferenceManager from "./messages/ConversationReferenceManager";

export default class Main extends EventEmitter {

    http: NetHTTP;
    server: ServerManager;
    ready_at: Date | null = null;
    database: Database;
    users: UserManager;
    instances: InstanceManager;
    sessions: SessionManager;
    auth: AuthManager;
    relays: RelayManager;
    badgers: BadgerManager;
    worlds: WorldManager;
    avatars: AvatarManager;
    netServers: NetServerManager;
    netUsers: NetUserManager;
    docker: DockerManager;
    notifications: NotificationManager;
    presences: PresenceManager;
    relations: RelationManager;
    devices: DeviceManager;
    emails: EmailManager;
    totp: TwoFactorManager;
    tables: TableManager;
    messages: MessageManager;
    conversations: ConversationManager;
    conversationReferences: ConversationReferenceManager;

    constructor() {
        super();

        this.database = new Database(this);
        this.http = new NetHTTP(this);
        this.server = new ServerManager(this);
        this.sessions = new SessionManager(this);
        this.users = new UserManager(this);
        this.instances = new InstanceManager(this);
        this.netServers = new NetServerManager(this);
        this.netUsers = new NetUserManager(this);
        this.auth = new AuthManager(this);
        this.badgers = new BadgerManager(this);
        this.worlds = new WorldManager(this);
        this.avatars = new AvatarManager(this);
        this.docker = new DockerManager(this);
        this.notifications = new NotificationManager(this);
        this.presences = new PresenceManager(this);
        this.relations = new RelationManager(this);
        this.devices = new DeviceManager(this);
        this.emails = new EmailManager(this);
        this.totp = new TwoFactorManager(this);
        this.tables = new TableManager(this);
        this.messages = new MessageManager(this);
        this.conversations = new ConversationManager(this);
        this.conversationReferences = new ConversationReferenceManager(this);
        this.relays = new RelayManager(this);
    }

    async start() {
        this.http.handler();
        await this.http.start();

        let init = true;
        while (!this.ready_at) {
            if (!init)
                Debug.log("Retrying to connect to database...");
            try {
                let result = await this.database.whenReady();
                if (result === true) {
                    Debug.log("Database connected.");
                    init = false;
                } else {
                    Debug.error("Database connection failed.");
                    Debug.error("Please check your database connection.");
                    Debug.error("Retrying in 10 seconds...");
                    await sleep(10000);
                }

                this.ready_at = new Date();
                this.emit('ready');
                Debug.log("Server ready.");

                let ns = await this.netServers.findNetServerByAddress(this.server.getInfos().address);
                if (!ns) {
                    let re = await this.netServers.initDiscover(this.server.getInfos().address);
                    if (!(re instanceof NetServer)) {
                        Debug.error("SelfServer registration failed.");
                        Debug.error(re.message);
                    } else {
                        ns = re;
                        var headers = await ns.requestHeaders();
                        Debug.log("SelfServer registered.");
                        Debug.error('Headers:', headers);
                    }
                } else Debug.log('SelfServer already registered.');
            } catch (e) {
                Debug.error("Database are not ready.");
                Debug.error("Please check your database connection.");
                Debug.error(e);
                Debug.error("Retrying in 10 seconds...");
                await sleep(10000);
            }
        }
    }
}