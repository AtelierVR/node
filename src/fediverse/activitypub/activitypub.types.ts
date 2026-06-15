// ── ActivityPub Core Types ───────────────────────────────────────────────────
// Based on W3C ActivityPub + ActivityStreams 2.0

export const ACTIVITYPUB_CONTENT_TYPE = 'application/activity+json';
export const ACTIVITYSTREAMS_CONTENT_TYPE = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

export const AP_CONTEXT = [
    'https://www.w3.org/ns/activitystreams',
    'https://w3id.org/security/v1',
];

// ── Core Objects ─────────────────────────────────────────────────────────────

export interface APObject {
    '@context': string | string[];
    id: string;
    type: string;
    name?: string;
    summary?: string;
    content?: string;
    published?: string;
    updated?: string;
    attributedTo?: string | APActor;
    to?: string | string[];
    cc?: string | string[];
    [key: string]: unknown;
}

export interface APActor extends APObject {
    type: 'Person' | 'Application' | 'Service' | 'Group' | 'Organization';
    preferredUsername: string;
    inbox: string;
    outbox: string;
    followers?: string;
    following?: string;
    liked?: string;
    publicKey?: {
        id: string;
        owner: string;
        publicKeyPem: string;
    };
    icon?: APImage;
    image?: APImage;
    url?: string;
    manuallyApprovesFollowers?: boolean;
}

export interface APImage {
    type: 'Image';
    url: string;
    mediaType: string;
}

// ── Activities ───────────────────────────────────────────────────────────────

export interface APActivity extends APObject {
    type: string;
    actor: string | APActor;
    object: string | APObject;
    target?: string | APObject;
    result?: string | APObject;
}

export interface APCreate extends APActivity {
    type: 'Create';
}

export interface APFollow extends APActivity {
    type: 'Follow';
}

export interface APAccept extends APActivity {
    type: 'Accept';
}

export interface APReject extends APActivity {
    type: 'Reject';
}

export interface APUndo extends APActivity {
    type: 'Undo';
}

export interface APDelete extends APActivity {
    type: 'Delete';
}

export interface APUpdate extends APActivity {
    type: 'Update';
}

export interface APAnnounce extends APActivity {
    type: 'Announce';
}

export interface APLike extends APActivity {
    type: 'Like';
}

// ── Collections ──────────────────────────────────────────────────────────────

export interface APCollection {
    '@context': string | string[];
    id: string;
    type: 'Collection' | 'OrderedCollection';
    totalItems: number;
    first?: string;
    last?: string;
    items?: (string | APObject)[];
}

export interface APOrderedCollection {
    '@context': string | string[];
    id: string;
    type: 'OrderedCollection';
    totalItems: number;
    first?: string;
    last?: string;
    orderedItems?: (string | APObject)[];
}

export interface APCollectionPage {
    '@context': string | string[];
    id: string;
    type: 'CollectionPage' | 'OrderedCollectionPage';
    partOf: string;
    next?: string;
    prev?: string;
    items?: (string | APObject)[];
    orderedItems?: (string | APObject)[];
}

// ── WebFinger Link for ActivityPub ──────────────────────────────────────────

export const AP_WEBFINGER_REL = 'self';
export const AP_WEBFINGER_TYPE = 'application/activity+json';
