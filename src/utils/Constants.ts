export const ErrorCodes = {
    NotImplemented: {
        message: "This endpoint is not implemented.",
        code: 1,
        status: 501
    },
    UserNotFound: {
        message: "User not found.",
        code: 2,
        status: 404
    },
    NotFound: {
        message: "{0} not found.",
        code: 3,
        status: 404
    },
    ServiceDisabled: {
        message: "This service is disabled.",
        code: 4,
        status: 403
    },
    InvalidField: {
        message: "Invalid field: {0}, {1}.",
        code: 5,
        status: 400
    },
    AlreadyExists: {
        message: "{0} already exists with {1}.",
        code: 6,
        status: 409
    },
    NotLogged: {
        message: "You are not logged in.",
        code: 7,
        status: 401
    },
    UnAuthorized: {
        message: "You are not authorized to {0}.",
        code: 8,
        status: 401
    },
    InternalError: {
        message: "An internal error occurred while trying to {0}.",
        code: 9,
        status: 500
    },
    ServerNotReady: {
        message: "The server is not ready yet.",
        code: 10,
        status: 503
    },
    InvalidChallenge: {
        message: "Invalid challenge.",
        code: 11,
        status: 400
    },
    RelayNotFound: {
        message: "Relay not found.",
        code: 12,
        status: 404
    },
    ServerNotFound: {
        message: "Server not found.",
        code: 13,
        status: 404
    },
    StandardError: {
        message: "{0}",
        code: 14,
        status: 500
    },
    SessionNotFound: {
        message: "Session not found.",
        code: 15,
        status: 404
    },
    InvalidRequest: {
        message: "Invalid request.",
        code: 16,
        status: 400
    },
    AlreadyValid: {
        message: "Already validated.",
        code: 17,
        status: 400
    },
    AlreadyRequested: {
        message: "Already requested.",
        code: 18,
        status: 400
    },
    Rejected: {
        message: "Rejected.",
        code: 19,
        status: 400
    },
    VerificationRequired: {
        message: "Additional verification required.",
        code: 20,
        status: 428
    },
    NotAcceptable: {
        message: "The requested resource is not acceptable.",
        code: 21,
        status: 406
    }
};

export const SafeLocalAddress = '::';
export const LocalAddressRegex = [
    /^::$/,
    /^::1$/,
    /^localhost$/,
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/g
];

export const UserTagOverrides = [
    { tags: ["sys:blacklisted", "mod:can_login"], overHide: "mod:blacklisted" },
    { tags: ["sys:blacklisted", "mod:can_self_delete"], overHide: "mod:blacklisted" },
    { tags: ["sys:blacklisted", "mod:can_self_edit"], overHide: "mod:blacklisted" },
];

export const Regex = {
    Username: /^[a-z0-9_.-]{3,16}$/,
    Password: /^.{6,}$/,
    Email: /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,4}$/,
    Display: /^.{3,32}$/,
    InstanceName: /^[a-z0-9]{3,6}$/,
}

export interface ErrorCode {
    message: string;
    code: number;
    status: number;
}