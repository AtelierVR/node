import { join } from "path";
import { hash, sha256 } from "./Utils";
import { cwd } from "process";
import UserIdentifier from "../users/UserIdentifier";
import Debug from "./Debug";

export function getContact() {
    return process.env.CONTACT || new UserIdentifier(getAdminId()).toString(getPreferedAddress());
}

export function getAdminId() {
    return parseInt(process.env.ADMIN_ID || '1');
}

export function getAdminUsername() {
    return process.env.ADMIN_USERNAME || 'admin';
}

export function getAdminDisplay() {
    return process.env.ADMIN_DISPLAY || 'Admin';
}

export function getAdminPassword() {
    return ((pass?: string) => pass && hash(pass))(process.env.ADMIN_PASSWORD)
}

export function getCanRegister() {
    return process.env.CAN_REGISTER === "true";
}

export function getHideIP() {
    return process.env.HIDE_IP === 'true';
}

export function getCustomCORS() {
    try {
        const customCors = process.env.CUSTOM_CORS;
        if (!customCors || customCors.trim() === '') {
            return {};
        }
        return JSON.parse(customCors);
    } catch (e) {
        Debug.error('Failed to parse CUSTOM_CORS environment variable:', e);
        Debug.error('Raw value:', JSON.stringify(process.env.CUSTOM_CORS));
        Debug.error('Using empty CORS configuration as fallback.');
        return {};
    }
}

export function getIgnorePaths() {
    return process.env.IGNORE_LOG_PATHS?.split(',') || [];
}

export function getSessionExpiration() {
    return new Date(Date.now() + parseInt(process.env.SESSION_EXPIRATION || "2592000000"));
}

export function getRelayTimeoutLimit() {
    return parseInt(process.env.RELAY_TIMEOUT_LIMIT || "15000");
}

export function getUploadTimeout() {
    return parseInt(process.env.UPLOAD_TIMEOUT || "300000"); // 5 minutes default
}

export function getMaxFileSize() {
    return parseInt(process.env.MAX_FILE_SIZE || "104857600"); // 100MB default
}

export function getMaxFieldSize() {
    return parseInt(process.env.MAX_FIELD_SIZE || "1048576"); // 1MB default
}

export function getMaxFiles() {
    return parseInt(process.env.MAX_FILES || "10"); // 10 files default
}
export function getDockerOptions(): object {
    return JSON.parse(process.env.DOCKER_OPTIONS || '{}');
}

export function getDockerImage(): string {
    return process.env.DOCKER_IMAGE || 'noxrelay';
}

export function getDockerNetwork(): string {
    return process.env.DOCKER_NETWORK || 'nox_default';
}

export function getDockerAddress(): string {
    return process.env.DOCKER_ADDRESS || '127.0.0.1';
}

export function getNodeIP(): string {
    return process.env.NODE_IP || '127.0.0.1'
}
export function getRelayIP(): string {
    return process.env.RELAY_IP || getNodeIP();
}

export function getDockerPort(): number {
    return parseInt(process.env.DOCKER_PORT || '23032');
}

export function getDockerMaxContainers(): number {
    return parseInt(process.env.DOCKER_MAX_CONTAINERS || '100');
}

export function getPort(): number {
    return parseInt(process.env.NODE_PORT || '53032');
}

export function getPreferedAddress(): string {
    return process.env.ADDRESS || 'localhost:' + getPort();
}

export function getBaseGateway(): string {
    return process.env.GATEWAY || getPreferedAddress();
}

export function getWebGateway(): string {
    return process.env.WEB_GATEWAY || `http${isSecure() ? 's' : ''}://${getBaseGateway()}`;
}

export function getName() {
    return process.env.TITLE || "Default Reileta Server";
};

export function getDescription() {
    return process.env.DESCRIPTION || "A server AtelierVR";
}

export function getIcon() {
    return new URL(process.env.ICON_URL || `http${isSecure() ? 's' : ''}://${getBaseGateway()}/icon.png`);
}

export function useSSL() {
    return process.env.USE_SSL === 'true';
}

export function isSecure() {
    return process.env.SECURE === 'true';
}

export function getPublicKeyFile() {
    return join(cwd(), process.env.PUBLICKEY_FILE || "certs/public.pem")
}

export function getPrivateKeyFile() {
    return join(cwd(), process.env.PRIVATEKEY_FILE || "certs/private.pem")
}

export function getCertificateFile() {
    return join(cwd(), process.env.CERTIFICATE_FILE || "certs/cert.pem")
}

export function getDefaultNetUserTags() {
    return process.env.DEFAULT_NETUSER_TAGS?.split(',') || [];
}

export function getDefaultUserTags() {
    return process.env.DEFAULT_USER_TAGS?.split(',') || [];
}

export function getSupportedWorldAssetEngines() {
    return process.env.SUPPORTED_WORLD_ASSET_ENGINE?.split(',') || [];
}

export function getSupportedWorldAssetPlatforms() {
    return process.env.SUPPORTED_WORLD_ASSET_PLATFORM?.split(',') || [];
}

export default {
    getContact,
    getAdminId,
    getAdminUsername,
    getAdminDisplay,
    getAdminPassword,
    getCanRegister,
    getHideIP,
    getCustomCORS,
    getIgnorePaths,
    getSessionExpiration,
    getRelayTimeoutLimit,
    getUploadTimeout,
    getMaxFileSize,
    getMaxFieldSize,
    getMaxFiles,
    getDockerOptions,
    getDockerImage,
    getNodeIP,
    getDockerPort,
    getDockerMaxContainers,
    getPort,
    getPreferedAddress,
    getBaseGateway,
    getWebGateway,
    getName,
    getDescription,
    getIcon,
    useSSL,
    isSecure,
    getPublicKeyFile,
    getPrivateKeyFile,
    getCertificateFile,
    getDefaultNetUserTags,
    getDefaultUserTags,
    getSupportedWorldAssetEngines,
    getSupportedWorldAssetPlatforms,
    getRelayIP,
    getDockerNetwork,
    getDockerAddress
}
