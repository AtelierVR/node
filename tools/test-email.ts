import Main from '../src/Main';
import * as Env from '../src/utils/Environment';
import * as fs from 'fs';
import * as path from 'path';

import Dotenv from 'dotenv';
import Debug from '../src/utils/Debug';
Dotenv.config({ path: '../.env' });

/**
 * Email System Test
 * 
 * This script validates the email functionality of the Nox application,
 * including SMTP configuration, template rendering, and email delivery.
 * 
 * @version 1.0.0
 * @author Nox Development Team
 * @usage node tools/test-email.js
 */

interface TestResults {
    total: number;
    passed: number;
    failed: number;
    errors: Array<{ test: string; error: string }>;
}

class EmailTestSuite {
    private app: Main | null = null;
    private testEmail: string;
    private results: TestResults;
    constructor() {
        this.testEmail = process.env.TEST_EMAIL || process.env.EMAIL_FROM || '';
        if (!this.testEmail) {
            Debug.error('❌ TEST_EMAIL or EMAIL_FROM environment variable is not set.');
            process.exit(1);
        }
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            errors: []
        };
    }    /**
     * Initialize the test suite
     */
    async initialize(): Promise<boolean> {
        Debug.log('═══════════════════════════════════════════════════════');
        Debug.log('           NOX EMAIL SYSTEM TEST SUITE v1.0');
        Debug.log('═══════════════════════════════════════════════════════\n');

        try {
            Debug.log('🔧 Initializing application...');
            this.app = new Main();

            // Allow time for proper initialization
            await new Promise(resolve => setTimeout(resolve, 1500));

            if (!this.app.emails) {
                throw new Error('Email manager not initialized');
            }

            Debug.log('✅ Application initialized successfully\n');
            return true;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            Debug.error('❌ Failed to initialize application:', errorMessage);
            return false;
        }
    }    /**
     * Validate email service configuration
     */
    validateConfiguration(): boolean {
        Debug.log('📋 CONFIGURATION VALIDATION');
        Debug.log('───────────────────────────────────────────────────────');

        if (!this.app?.emails?.isAvailable()) {
            Debug.log('❌ Email service is not available');
            Debug.log('   Required environment variables:');
            Debug.log('   • EMAIL_HOST (SMTP server)');
            Debug.log('   • EMAIL_USER (authentication username)');
            Debug.log('   • EMAIL_PASSWORD (authentication password)');
            Debug.log('   • EMAIL_PORT (default: 587)');
            Debug.log('   • EMAIL_FROM (sender address)');
            Debug.log('\n   Please check your .env configuration file.\n');
            return false;
        }

        Debug.log('✅ Email service is properly configured and available');
        Debug.log(`📧 Test recipient: ${this.testEmail}`);
        Debug.log('');
        return true;
    }/**
     * Execute a single test case
     */
    async executeTest(testName: string, testFunction: () => Promise<boolean>): Promise<boolean> {
        this.results.total++;

        try {
            Debug.log(`🧪 Test ${this.results.total}: ${testName}`);
            const result = await testFunction();

            if (result) {
                this.results.passed++;
                Debug.log(`✅ ${testName} - PASSED`);
            } else {
                this.results.failed++;
                Debug.log(`❌ ${testName} - FAILED`);
            }

            Debug.log('');
            return result;
        } catch (error: unknown) {
            this.results.failed++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.results.errors.push({ test: testName, error: errorMessage });
            Debug.error(`❌ ${testName} - ERROR: ${errorMessage}`);
            Debug.log('');
            return false;
        }
    }    /**
     * Test simple email sending
     */
    async testSimpleEmail(): Promise<boolean> {
        const subject = 'Nox Email System Test - Simple Email';
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-inline-size: 600px; margin: 0 auto;">
                <h1 style="color: #2563eb;">Email System Test</h1>
                <p>This is a test email from the Nox email system.</p>
                <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                    <strong>Test Details:</strong><br>
                    • Test Type: Simple Email<br>
                    • Timestamp: ${new Date().toISOString()}<br>
                    • Recipient: ${this.testEmail}
                </div>
                <p style="color: #6b7280; font-size: 14px;">
                    If you received this email, the simple email functionality is working correctly.
                </p>
            </div>
        `;

        const textContent = `
Email System Test

This is a test email from the Nox email system.

Test Details:
• Test Type: Simple Email
• Timestamp: ${new Date().toISOString()}
• Recipient: ${this.testEmail}

If you received this email, the simple email functionality is working correctly.
        `.trim(); return await this.app!.emails.sendEmail(
            this.testEmail,
            subject,
            htmlContent,
            textContent
        );
    }    /**
     * Test templated email sending
     */
    async testTemplatedEmail(): Promise<boolean> {
        const serverUrl = new URL(`http${Env.isSecure() ? 's' : ''}://` + Env.getBaseGateway())
        const templateVariables = {
            username: 'test-user',
            display: 'Test User',
            serverName: 'Nox Development Server',
            serverUrl: serverUrl.toString(),
            loginUrl: new URL('/login', serverUrl).toString(),
            timestamp: new Date().toISOString()
        }; return await this.app!.emails.sendTemplatedEmail(
            this.testEmail,
            'welcome',
            templateVariables,
            'Nox Email System Test - Welcome Template'
        );
    }    /**
     * Test email verification functionality
     */
    async testEmailVerification(): Promise<boolean> {
        const verificationToken = 'test-verification-token-' + Date.now();
        const verificationUrl = `${Env.isSecure() ? 'https' : 'http'}://${Env.getBaseGateway()}/verify-email?token=${verificationToken}`;

        return await this.app!.emails.sendTemplatedEmail(
            this.testEmail,
            'email-verification',
            {
                username: 'test-user',
                display: 'Test User',
                verificationUrl,
                serverName: Env.getName(),
                serverUrl: `${Env.isSecure() ? 'https' : 'http'}://${Env.getBaseGateway()}`
            },
            `Verify your email address - ${Env.getName()}`
        );
    }/**
     * List available email templates
     */
    listAvailableTemplates(): void {
        Debug.log('📋 AVAILABLE EMAIL TEMPLATES');
        Debug.log('───────────────────────────────────────────────────────'); try {
            const templatesDir = path.join(__dirname, '..', 'templates');
            const files = fs.readdirSync(templatesDir);
            const templates = files
                .filter(file => file.endsWith('.json'))
                .map(file => file.replace('.json', ''));

            if (templates.length > 0) {
                templates.forEach((template, index) => {
                    Debug.log(`${index + 1}. ${template}`);
                });
                Debug.log(`\nTotal templates: ${templates.length}`);
            } else {
                Debug.log('⚠️  No templates found in templates directory');
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            Debug.log('❌ Unable to read templates directory:', errorMessage);
        }

        Debug.log('');
    }    /**
     * Test all available email templates
     */
    async testAllTemplates(): Promise<boolean> {
        try {
            const templatesDir = path.join(__dirname, '..', 'templates');
            const files = fs.readdirSync(templatesDir);
            const templates = files
                .filter(file => file.endsWith('.json'))
                .map(file => file.replace('.json', ''));

            if (templates.length === 0) {
                Debug.log('⚠️  No templates found');
                return false;
            }
            
            let successCount = 0;

            Debug.log(`📧 Testing ${templates.length} email templates...\n`);

            for (const template of templates) {
                try {
                    const success = await this.app!.emails.sendTemplatedEmail(
                        this.testEmail,
                        template,
                        {},
                        `[TEST] ${template}`
                    );

                    if (success) {
                        Debug.log(`✅ ${template} - Email sent successfully`);
                        successCount++;
                    } else {
                        Debug.log(`❌ ${template} - Failed to send email`);
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    Debug.log(`❌ ${template} - Error: ${errorMessage}`);
                }
            }

            Debug.log(`\n📊 Templates Test Summary: ${successCount}/${templates.length} successful`);
            return successCount === templates.length;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            Debug.error('❌ Failed to test templates:', errorMessage);
            return false;
        }
    }    /**
     * Display comprehensive test results
     */
    displayResults(): void {
        Debug.log('═══════════════════════════════════════════════════════');
        Debug.log('                    TEST RESULTS');
        Debug.log('═══════════════════════════════════════════════════════');

        const passRate = this.results.total > 0 ?
            ((this.results.passed / this.results.total) * 100).toFixed(1) : 0;

        Debug.log(`📊 Total Tests: ${this.results.total}`);
        Debug.log(`✅ Passed: ${this.results.passed}`);
        Debug.log(`❌ Failed: ${this.results.failed}`);
        Debug.log(`📈 Success Rate: ${passRate}%`);

        if (this.results.errors.length > 0) {
            Debug.log('\n🚨 ERROR DETAILS:');
            this.results.errors.forEach((error, index) => {
                Debug.log(`${index + 1}. ${error.test}: ${error.error}`);
            });
        }

        Debug.log('\n📧 Configuration Details:');
        Debug.log(`   • Test Email: ${this.testEmail}`);
        Debug.log(`   • Service Status: ${this.app?.emails?.isAvailable() ? 'Available' : 'Unavailable'}`);

        const status = this.results.failed === 0 ? 'SUCCESS' : 'FAILED';
        const statusIcon = this.results.failed === 0 ? '🎉' : '⚠️';

        Debug.log(`\n${statusIcon} TEST SUITE ${status}`);
        Debug.log('═══════════════════════════════════════════════════════\n');
    }    /**
     * Execute the complete test suite
     */
    async run(): Promise<void> {
        try {
            // Initialize
            const initialized = await this.initialize();
            if (!initialized) {
                process.exit(1);
            }

            // Validate configuration
            const configValid = this.validateConfiguration();
            if (!configValid) {
                process.exit(1);
            }

            // Run tests
            await this.executeTest(
                'Simple Email Delivery',
                () => this.testSimpleEmail()
            );

            await this.executeTest(
                'Template-based Email',
                () => this.testTemplatedEmail()
            ); await this.executeTest(
                'Email Verification',
                () => this.testEmailVerification()
            );

            await this.executeTest(
                'All Email Templates',
                () => this.testAllTemplates()
            );

            // Display additional information
            this.listAvailableTemplates();

            // Show results
            this.displayResults();

            // Exit with appropriate code
            process.exit(this.results.failed === 0 ? 0 : 1);

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            Debug.error('\n❌ Test suite execution failed:', errorMessage);
            if (errorStack) {
                Debug.error(errorStack);
            }
            process.exit(1);
        }
    }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
    const testSuite = new EmailTestSuite();
    await testSuite.run();
}

// Execute if script is called directly
if (require.main === module) {
    main().catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        Debug.error('Fatal error:', errorMessage);
        process.exit(1);
    });
}

export { EmailTestSuite, main };
