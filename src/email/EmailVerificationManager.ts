import { randomBytes, createHash } from 'node:crypto';
import User from '../users/User';
import Main from '../Main';
import { VerificationFactorResult } from '../auth/VerificationFactorManager';
import Debug from '../utils/Debug';

/**
 * Result interface for email verification operations
 * Contains success status, message, and optionally the verified user
 */
export interface EmailVerificationResult {
    /** Whether the email verification was successful */
    success: boolean;
    /** Descriptive message about the verification result */
    message: string;
    /** The user object if verification was successful */
    user?: User;
}

/**
 * Manager class for email verification functionality
 * Handles email verification token generation, validation, and email verification workflow
 * Integrates with the database for token storage and user email verification status
 */
export default class EmailVerificationManager {
    /** Token expiry time in hours */
    private static readonly TOKEN_EXPIRY_HOURS = 24;

    /**
     * Constructor for EmailVerificationManager
     * @param app - Main application instance providing access to services
     */
    constructor(private readonly app: Main) { }

    /**
     * Verify a factor email code for multi-factor authentication
     * Validates a verification code sent via email as part of the MFA process
     * @param user - The user attempting verification
     * @param code - The verification code received via email
     * @returns VerificationFactorResult with success status and message
     */
    async verifyFactorEmailCode(user: User, code: string): Promise<VerificationFactorResult> {
        const method = 'email';
        if (!user.email || !user.email_verified)
            return {
                success: false,
                message: 'User has no email address for verification',
                verified_method: method
            };

        try {
            const factor = await this.app.database.verificationFactor.findFirst({
                where: {
                    user_id: user.id,
                    method: method,
                    code: code,
                    expires_at: {
                        gt: new Date()
                    }
                }
            });

            if (!factor)
                return {
                    success: false,
                    message: 'Invalid or expired verification code',
                    verified_method: method
                };

            // Delete the factor code after successful verification
            await this.app.database.verificationFactor.delete({
                where: { id: factor.id }
            });

            return {
                success: true,
                message: 'Verification code is valid',
                verified_method: method
            }
        } catch (error) {
            Debug.error('Error verifying factor code:', error);
            return {
                success: false,
                message: 'Error verifying factor code',
                verified_method: method
            };
        }
    }
    
    /**
     * Create an email verification token for a user
     * Generates a cryptographically secure token for email verification
     * Stores the token in the database with expiration time
     * @param user - The user for whom to create the verification token
     * @returns The generated token string, or null if creation failed
     */
    async createVerificationToken(user: User): Promise<string | null> {
        if (!user.email) {
            Debug.error('User has no email address for verification');
            return null;
        }

        try {
            // Generate a secure token
            const randomData = randomBytes(32).toString('hex');
            const timestamp = Date.now().toString();
            const secret = process.env.JWT_SECRET || 'default-secret-change-in-production';

            // Create a hash of user ID, email, timestamp, random data, and secret
            const tokenData = `${user.id}:${user.email}:${timestamp}:${randomData}:${secret}`;
            const token = createHash('sha256').update(tokenData).digest('hex');

            const expiresAt = new Date(Date.now() + EmailVerificationManager.TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

            // Delete any existing verification tokens for this user
            await this.app.database.emailVerification.deleteMany({
                where: {
                    user_id: user.id
                }
            });

            // Create new verification record
            await this.app.database.emailVerification.create({
                data: {
                    user_id: user.id,
                    token: token,
                    email: user.email,
                    expires_at: expiresAt,
                    verified: false
                }
            });

            return token;
        } catch (error) {
            Debug.error('Error creating email verification token:', error);
            return null;
        }
    }

    /**
     * Send email verification to user
     * Creates a verification token and sends it via email to the user
     * @param user - The user to send the verification email to
     * @returns true if the email was sent successfully, false otherwise
     */
    async sendVerificationEmail(user: User): Promise<boolean> {
        if (!user.email) {
            Debug.error('User has no email address for verification');
            return false;
        }

        const token = await this.createVerificationToken(user);
        if (!token) {
            Debug.error('Failed to create verification token');
            return false;
        }

        try {
            return await this.app.emails.sendEmailVerification(user, token);
        } catch (error) {
            Debug.error('Error sending verification email:', error);
            return false;
        }
    }

    /**
     * Verify an email token
     * Validates an email verification token and marks the user's email as verified
     * Updates the user's verification status in the database
     * @param token - The verification token to validate
     * @returns EmailVerificationResult with success status, message, and user data
     */
    async verifyEmailToken(token: string): Promise<EmailVerificationResult> {
        try {
            const verification = await this.app.database.emailVerification.findFirst({
                where: {
                    token: token,
                    verified: false,
                    expires_at: {
                        gt: new Date()
                    }
                }
            });

            if (!verification) {
                return {
                    success: false,
                    message: 'Invalid or expired verification token'
                };
            }

            // Get the user
            const user = await this.app.users.findUserById(verification.user_id);
            if (!user) {
                return {
                    success: false,
                    message: 'User not found'
                };
            }

            // Update user email verification status
            user.email_verified = true;
            const updatedUser = await user.update();

            if (!updatedUser) {
                return {
                    success: false,
                    message: 'Failed to update user verification status'
                };
            }

            // Mark the verification as completed
            await this.app.database.emailVerification.update({
                where: { id: verification.id },
                data: { verified: true }
            });

            return {
                success: true,
                message: 'Email verified successfully',
                user: updatedUser
            };

        } catch (error) {
            Debug.error('Error verifying email token:', error);
            return {
                success: false,
                message: 'Error verifying email token'
            };
        }
    }

    /**
     * Check if user's email is verified
     * Simple helper method to check the user's email verification status
     * @param user - The user to check
     * @returns true if the user's email is verified, false otherwise
     */
    async isEmailVerified(user: User): Promise<boolean> {
        return user.email_verified;
    }

    /**
     * Resend verification email to user
     * Checks if email is already verified before sending a new verification email
     * Creates a new token and sends it if needed
     * @param user - The user to resend the verification email to
     * @returns true if the email was sent or already verified, false if failed
     */
    async resendVerificationEmail(user: User): Promise<boolean> {
        if (!user.email) {
            Debug.error('User has no email address for verification');
            return false;
        }

        if (user.email_verified) {
            Debug.log('User email is already verified');
            return true;
        }

        return await this.sendVerificationEmail(user);
    }

    /**
     * Cleanup expired verification tokens (called periodically)
     * Removes expired email verification tokens from the database
     * Should be called periodically by a maintenance task
     * @returns Promise that resolves when cleanup is complete
     */
    async cleanupExpiredTokens(): Promise<void> {
        try {
            const result = await this.app.database.emailVerification.deleteMany({
                where: {
                    expires_at: {
                        lt: new Date()
                    }
                }
            });

            if (result.count > 0) {
                Debug.log(`Cleaned up ${result.count} expired email verification tokens`);
            }
        } catch (error) {
            Debug.error('Error cleaning up expired email verification tokens:', error);
        }
    }
}
