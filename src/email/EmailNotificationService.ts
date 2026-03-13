import EmailManager from '../email/EmailManager';
import User from '../users/User';
import Debug from '../utils/Debug';
import Env from '../utils/Environment';

/**
 * Extension du système de notifications pour inclure l'envoi d'emails
 * Cette classe peut être utilisée pour étendre NotificationManager
 * et ajouter la fonctionnalité d'envoi d'emails pour les notifications importantes.
 * Permet d'envoyer des notifications critiques par email en plus des notifications en temps réel
 */
export class EmailNotificationService {
    /**
     * Constructor for EmailNotificationService
     * @param emailManager - EmailManager instance for sending emails
     */
    constructor(private emailManager: EmailManager) {}

    /**
     * Envoie une notification par email
     * Sends important notifications via email using templates
     * @param user - The user to send the notification to
     * @param notification - Notification object containing type, title, message, and optional data
     * @returns true if the email was sent successfully, false otherwise
     */
    async sendNotificationEmail(
        user: User, 
        notification: {
            type: string;
            title: string;
            message: string;
            urgency?: 'low' | 'medium' | 'high';
            actionUrl?: string;
            data?: Record<string, any>;
        }
    ): Promise<boolean> {
        if (!user.email || !this.emailManager.isAvailable()) {
            return false;
        }

        const variables = {
            username: user.username,
            display: user.display,
            serverName: Env.sync('TITLE'),
            serverUrl: `${Env.sync('SECURE') ? 'https' : 'http'}://${Env.sync('GATEWAY')}`,
            notificationType: notification.type,
            notificationTitle: notification.title,
            notificationMessage: notification.message,
            timestamp: new Date().toLocaleString('fr-FR'),
            dashboardUrl: `${Env.sync('SECURE') ? 'https' : 'http'}://${Env.sync('GATEWAY')}/dashboard`,
            ...notification.data
        };

        return await this.emailManager.sendTemplatedEmail(
            user.email,
            'notification',
            variables,
            `${notification.title} - ${Env.sync('TITLE')}`
        );
    }

    /**
     * Envoie un email pour une action requise
     * Sends emails for actions that require user attention with deadlines
     * @param user - The user who needs to take action
     * @param action - Action object containing type, description, deadline, and action URL
     * @returns true if the email was sent successfully, false otherwise
     */
    async sendActionRequiredEmail(
        user: User,
        action: {
            type: string;
            description: string;
            deadline: string;
            urgency: 'low' | 'medium' | 'high';
            actionUrl: string;
            details?: string;
        }
    ): Promise<boolean> {
        if (!user.email || !this.emailManager.isAvailable()) {
            return false;
        }

        const variables = {
            username: user.username,
            display: user.display,
            serverName: Env.sync('TITLE'),
            serverUrl: `${Env.sync('SECURE') ? 'https' : 'http'}://${Env.sync('GATEWAY')}`,
            actionType: action.type,
            description: action.description,
            deadline: action.deadline,
            urgency: action.urgency,
            actionUrl: action.actionUrl,
            details: action.details || ''
        };

        return await this.emailManager.sendTemplatedEmail(
            user.email,
            'action-required',
            variables
        );
    }

    /**
     * Envoie un email d'alerte de sécurité
     * Sends security alert emails for important security events
     * @param user - The user to alert about security events
     * @param activity - Security activity object containing event details and location info
     * @returns true if the email was sent successfully, false otherwise
     */
    async sendSecurityAlertEmail(
        user: User,
        activity: {
            type: string;
            timestamp: string;
            location: string;
            ipAddress: string;
        }
    ): Promise<boolean> {
        if (!user.email || !this.emailManager.isAvailable()) {
            return false;
        }

        const variables = {
            username: user.username,
            display: user.display,
            serverName: Env.sync('TITLE'),
            serverUrl: `${Env.sync('SECURE') ? 'https' : 'http'}://${Env.sync('GATEWAY')}`,
            activityType: activity.type,
            timestamp: activity.timestamp,
            location: activity.location,
            ipAddress: activity.ipAddress,
            securityUrl: `${Env.sync('SECURE') ? 'https' : 'http'}://${Env.sync('GATEWAY')}/security`
        };

        return await this.emailManager.sendTemplatedEmail(
            user.email,
            'security-alert',
            variables
        );
    }

    /**
     * Envoie des emails de notification en lot
     * Sends notification emails to multiple users simultaneously
     * @param users - Array of users to send notifications to
     * @param notification - Notification object to send to all users
     * @returns Object containing success and failed counts
     */
    async sendBulkNotifications(
        users: User[],
        notification: {
            type: string;
            title: string;
            message: string;
            urgency?: 'low' | 'medium' | 'high';
            actionUrl?: string;
            data?: Record<string, any>;
        }
    ): Promise<{ success: number; failed: number }> {
        let success = 0;
        let failed = 0;

        const promises = users
            .filter(user => user.email) // Seuls les utilisateurs avec email
            .map(async (user) => {
                try {
                    const result = await this.sendNotificationEmail(user, notification);
                    if (result) {
                        success++;
                    } else {
                        failed++;
                    }
                } catch (error) {
                    Debug.error(`Failed to send email to ${user.email}:`, error);
                    failed++;
                }
            });

        await Promise.allSettled(promises);

        return { success, failed };
    }
}

/**
 * Types d'emails prédéfinis pour différents scénarios
 * Predefined email templates for various notification scenarios
 * Provides consistent notification types with appropriate urgency levels
 */
export const EmailTemplates = {
    /** System maintenance notifications */
    // Notifications système
    SYSTEM_MAINTENANCE: {
        type: 'system_maintenance',
        title: 'Maintenance programmée',
        urgency: 'medium' as const
    },
    
    /** System update notifications */
    SYSTEM_UPDATE: {
        type: 'system_update',
        title: 'Mise à jour du système',
        urgency: 'low' as const
    },

    /** Security-related notifications */
    // Sécurité
    SUSPICIOUS_LOGIN: {
        type: 'suspicious_login',
        title: 'Connexion suspecte détectée',
        urgency: 'high' as const
    },

    /** Password change notifications */
    PASSWORD_CHANGED: {
        type: 'password_changed',
        title: 'Mot de passe modifié',
        urgency: 'high' as const
    },

    /** Content moderation notifications */
    // Modération
    CONTENT_VIOLATION: {
        type: 'content_violation',
        title: 'Violation des conditions d\'utilisation',
        urgency: 'high' as const
    },

    ACCOUNT_WARNING: {
        type: 'account_warning',
        title: 'Avertissement de compte',
        urgency: 'medium' as const
    },

    // Social
    NEW_FOLLOWER: {
        type: 'new_follower',
        title: 'Nouveau follower',
        urgency: 'low' as const
    },

    FRIEND_REQUEST: {
        type: 'friend_request',
        title: 'Nouvelle demande d\'ami',
        urgency: 'low' as const
    }
};

export default EmailNotificationService;
