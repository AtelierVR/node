import nodemailer, { Transporter } from 'nodemailer';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import Main from '../Main';
import User from '../users/User';
import * as Env from '../utils/Environment';
import EmailAPIWeb from './EmailAPIWeb';
import EmailVerificationManager from './EmailVerificationManager';
import Debug from '../utils/Debug';

/**
 * Manager class for email functionality
 * Handles email transporter setup, template loading, and email sending operations
 * Provides integration with SMTP servers and email verification workflows
 */
export default class EmailManager {
    /** Nodemailer transporter instance for sending emails */
    private transporter: Transporter | null = null;
    /** Web API handler for email-related endpoints */
    private api_web: EmailAPIWeb;
    /** Email verification manager for handling email verification workflows */
    verification: EmailVerificationManager;

    /**
     * Constructor for EmailManager
     * Initializes email transporter and related services
     * @param app - Main application instance providing access to services
     */
    constructor(private readonly app: Main) {
        this.initializeTransporter();
        this.api_web = new EmailAPIWeb(this.app, this);
        this.verification = new EmailVerificationManager(this.app);
    }

    /**
     * Initialize the email transporter with SMTP configuration
     * Sets up nodemailer transporter using environment variables
     * Verifies the connection and logs the result
     */
    private initializeTransporter() {
        const host = process.env.EMAIL_HOST;
        const port = parseInt(process.env.EMAIL_PORT || '587');
        const secure = process.env.EMAIL_SECURE === 'true';
        const user = process.env.EMAIL_USER;
        const pass = process.env.EMAIL_PASSWORD;

        if (!host || !user || !pass) {
            Debug.warn('Email configuration is incomplete. Email sending will be disabled.');
            return;
        } this.transporter = nodemailer.createTransport({
            host,
            port,
            secure,
            auth: {
                user,
                pass,
            },
        });

        // Verify connection
        this.transporter.verify((error) => {
            if (error) {
                Debug.error('Email transporter verification failed:', error);
                this.transporter = null;
            } else {
                Debug.log('Email transporter is ready');
            }
        });
    }

    /**
     * Check if email service is available
     * Verifies that the email transporter is properly configured and ready
     * @returns true if email service is available, false otherwise
     */
    isAvailable(): boolean {
        return this.transporter !== null;
    }

    /**
     * Send an email using a template
     * Loads an HTML template, replaces variables, and sends the email
     * @param to - Recipient email address
     * @param templateName - Name of the email template file
     * @param variables - Object containing variables to replace in the template
     * @param subject - Optional email subject (defaults to template default)
     * @returns true if email was sent successfully, false otherwise
     */
    async sendTemplatedEmail(
        to: string,
        templateName: string,
        variables: Record<string, any>,
        subject?: string
    ): Promise<boolean> {
        if (!this.isAvailable()) {
            Debug.error('Email service is not available');
            return false;
        }

        try {
            const template = this.loadTemplate(templateName);
            if (!template) {
                Debug.error(`Template '${templateName}' not found`);
                return false;
            }

            const renderedHtml = this.renderTemplate(template.html, variables);
            const renderedText = template.text ? this.renderTemplate(template.text, variables) : undefined;
            const emailSubject = subject || this.renderTemplate(template.subject || '', variables);

            const mailOptions = {
                from: this.getFromAddress(),
                to,
                subject: emailSubject,
                html: renderedHtml,
                text: renderedText,
            };

            await this.transporter!.sendMail(mailOptions);
            Debug.log(`Email sent successfully to ${to} using template ${templateName}`);
            return true;
        } catch (error) {
            Debug.error('Error sending email:', error);
            return false;
        }
    }

    /**
     * Send a simple email without template
     * Sends an email with provided HTML/text content directly
     * @param to - Recipient email address
     * @param subject - Email subject line
     * @param html - HTML content of the email
     * @param text - Optional plain text version of the email
     * @returns true if email was sent successfully, false otherwise
     */
    async sendEmail(
        to: string,
        subject: string,
        html: string,
        text?: string
    ): Promise<boolean> {
        if (!this.isAvailable()) {
            Debug.error('Email service is not available');
            return false;
        }

        try {
            const mailOptions = {
                from: this.getFromAddress(),
                to,
                subject,
                html,
                text,
            };

            await this.transporter!.sendMail(mailOptions);
            Debug.log(`Email sent successfully to ${to}`);
            return true;
        } catch (error) {
            Debug.error('Error sending email:', error);
            return false;
        }
    }

    /**
     * Send verification code via email
     * Creates a verification factor code and sends it to the user's email
     * Used for multi-factor authentication workflows
     * @param user - The user to send the verification code to
     * @returns true if the code was sent successfully, false otherwise
     */
    async sendEmailVerificationCode(user: User): Promise<boolean> {
        if (!user.email) {
            Debug.error('User has no email address for verification');
            return false;
        }

        const code = await this.app.auth.verification.createFactorCode(user, 'email');
        if (!code) {
            Debug.error('Failed to create verification code');
            return false;
        }

        try {
            return await this.app.emails.sendVerificationCode(user, code);
        } catch (error) {
            Debug.error('Error sending verification code:', error);
            return false;
        }
    }

    /**
     * Send email verification to user
     * Sends an email with a verification link to confirm the user's email address
     * Used for initial email address verification during registration
     * @param user - The user to send the verification email to
     * @param verificationToken - The verification token to include in the email link
     * @returns true if the email was sent successfully, false otherwise
     */
    async sendEmailVerification(user: User, verificationToken: string): Promise<boolean> {
        if (!user.email) {
            Debug.error('User has no email address');
            return false;
        }

        const webGatewayUrl = new URL(Env.getWebGateway());
        const verificationUrl = `${webGatewayUrl.origin}/verify-email?token=${verificationToken}`;

        return await this.sendTemplatedEmail(
            user.email,
            'email-verification',
            {
                username: user.username,
                display: user.display,
                verificationUrl,
                serverName: Env.getName(),
                serverUrl: webGatewayUrl.origin
            },
            `Verify your email address - ${Env.getName()}`
        );
    }

    /**
     * Send password reset email
     * Sends an email with a password reset link to the user
     * @param user - The user requesting password reset
     * @param resetToken - The password reset token to include in the email link
     * @returns true if the email was sent successfully, false otherwise
     */
    async sendPasswordReset(user: User, resetToken: string): Promise<boolean> {
        if (!user.email) {
            Debug.error('User has no email address');
            return false;
        }

        const webGatewayUrl = new URL(Env.getWebGateway());
        const resetUrl = `${webGatewayUrl.origin}/reset-password?token=${resetToken}`;

        return await this.sendTemplatedEmail(
            user.email,
            'password-reset',
            {
                username: user.username,
                display: user.display,
                resetUrl,
                serverName: Env.getName(),
                serverUrl: webGatewayUrl.origin,
                expiresIn: '1 hour'
            },
            `Reset your password - ${Env.getName()}`
        );
    }

    /**
     * Send welcome email to new users
     * Sends a welcome email after successful user registration
     * @param user - The newly registered user
     * @returns true if the email was sent successfully, false otherwise
     */
    async sendWelcomeEmail(user: User): Promise<boolean> {
        if (!user.email) {
            return false;
        }

        const webGatewayUrl = new URL(Env.getWebGateway());

        return await this.sendTemplatedEmail(
            user.email,
            'welcome',
            {
                username: user.username,
                display: user.display,
                serverName: Env.getName(),
                serverUrl: webGatewayUrl.origin,
                loginUrl: `${webGatewayUrl.origin}/login`
            },
            `Welcome to ${Env.getName()}!`
        );
    }

    /**
     * Send verification code for multi-factor authentication
     * Sends a 6-digit verification code via email for MFA purposes
     * @param user - The user to send the verification code to
     * @param code - The 6-digit verification code to send
     * @returns true if the email was sent successfully, false otherwise
     */
    async sendVerificationCode(user: User, code: string): Promise<boolean> {
        if (!user.email) {
            Debug.error('User has no email address');
            return false;
        }

        return await this.sendTemplatedEmail(
            user.email,
            'verification-code',
            {
                username: user.username,
                display: user.display,
                verificationCode: code,
                serverName: Env.getName(),
                serverUrl: `${Env.isSecure() ? 'https' : 'http'}://${Env.getBaseGateway()}`,
                expiresIn: '10 minutes'
            },
            `Verification Code - ${Env.getName()}`
        );
    }    /**
     * Load email template from file
     * Reads and parses an email template from the templates directory
     * @param templateName - Name of the template file (without .json extension)
     * @returns EmailTemplate object or null if template not found or invalid
     */
    private loadTemplate(templateName: string): EmailTemplate | null {
        const templatePath = join(cwd(), 'templates', `${templateName}.json`);

        if (!existsSync(templatePath)) {
            return null;
        }

        try {
            const templateContent = readFileSync(templatePath, 'utf-8');
            return JSON.parse(templateContent) as EmailTemplate;
        } catch (error) {
            Debug.error(`Error loading template ${templateName}:`, error);
            return null;
        }
    }

    /**
     * Render template with variables
     * Replaces template variables ({{variable}}) with actual values
     * @param template - The template string containing variables to replace
     * @param variables - Object containing variable names and their values
     * @returns Rendered template string with variables replaced
     */
    private renderTemplate(template: string, variables: Record<string, any>): string {
        let rendered = template;

        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
            rendered = rendered.replace(regex, String(value));
        }

        return rendered;
    }

    /**
     * Get the from address for emails
     * Constructs the sender address using environment configuration
     * @returns Formatted email sender address with optional display name
     */
    private getFromAddress(): string {
        const fromEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER;
        const fromName = process.env.EMAIL_FROM_NAME || Env.getName();

        if (fromName && fromEmail) {
            return `"${fromName}" <${fromEmail}>`;
        }

        return fromEmail || 'noreply@localhost';
    }
}

/**
 * Interface defining the structure of email templates
 * Used for loading and parsing email template files
 */
export interface EmailTemplate {
    /** Email subject line template (supports variable replacement) */
    subject: string;
    /** HTML content template (supports variable replacement) */
    html: string;
    /** Optional plain text version of the email (supports variable replacement) */
    text?: string;
}

/**
 * Interface for email sending options
 * Used when sending emails without templates
 */
export interface EmailOptions {
    /** Recipient email address */
    to: string;
    /** Email subject line */
    subject: string;
    /** HTML content of the email */
    html: string;
    /** Optional plain text version of the email */
    text?: string;
    /** Optional template name to use instead of direct HTML */
    template?: string;
    /** Optional variables for template rendering */
    variables?: Record<string, any>;
}
