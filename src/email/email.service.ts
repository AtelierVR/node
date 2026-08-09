import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfigService } from '../config/config.service';
import { parseLocalizedString } from '../config/config.schema';
import { cwd } from 'node:process';

interface TemplateSource {
    /** "file" → read value as a relative path from the template dir; "html" → use value directly */
    type?: 'file' | 'value';
    value: string;
}

/** A render node may have an optional parent for recursive template composition. */
interface TemplateRenderNode extends TemplateSource {
    parent?: string | null;
}

interface EmailTemplateIndex {
    /** Subject can be a plain string or a TemplateRenderNode with optional parent. */
    subject: string | TemplateRenderNode;
    render: TemplateRenderNode;
    alt?: TemplateSource;
}

interface EmailTemplate {
    subject: string;
    render: string;
    alt?: string;
}

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);
    private transporter: Transporter | null = null;
    private initialized = false;

    constructor(private readonly config: AppConfigService) { }

    async onModuleInit() {
        const enabled = await this.config.get<boolean>('email.enabled');
        if (!enabled) {
            this.logger.warn('Email is disabled (email.enabled=false). No emails will be sent.');
            return;
        }

        const host = await this.config.get<string>('email.host');
        const port = await this.config.get<number>('email.port');
        const secure = await this.config.get<boolean>('email.secure');
        const user = await this.config.get<string>('email.user');
        const pass = await this.config.get<string>('email.password');

        if (!host || !user || !pass) {
            this.logger.warn('Email config incomplete — host/user/password required. Email disabled.');
            return;
        }

        this.transporter = createTransport({ host, port, secure, auth: { user, pass } });

        try {
            await this.transporter.verify();
            this.initialized = true;
            this.logger.log(`Email transporter ready (${host}:${port})`);
        } catch (err) {
            this.logger.error(`Email transporter verification failed: ${(err as Error).message}`);
            this.transporter = null;
        }
    }

    isAvailable(): boolean {
        return this.initialized && this.transporter !== null;
    }

    /**
     * Load a template by name. Recursively resolves parent templates,
     * injecting the child's subject, render, and alt into the parent
     * via {{subject}}, {{render}}, {{alt}} placeholders.
     *
     * When render or alt have a parent set, loadTemplate is called
     * recursively on the parent, and the child's values are injected.
     */
    private loadTemplate(name: string): EmailTemplate {
        const dir = join(cwd(), 'templates', 'emails', name);
        const indexPath = join(dir, 'index.json');

        if (!existsSync(indexPath))
            throw new Error(`Email template "${name}" not found at ${indexPath}`);

        const index: EmailTemplateIndex = JSON.parse(readFileSync(indexPath, 'utf-8'));

        // Resolve a TemplateSource: file → read, html → use directly
        const resolveSource = (source: TemplateSource, baseDir: string): string => {
            if (source.type === 'value')
                return source.value;
            // default to file
            const filePath = join(baseDir, source.value);
            if (!existsSync(filePath))
                throw new Error(`Template file "${source.value}" not found for template "${name}" at ${filePath}`);
            return readFileSync(filePath, 'utf-8');
        };

        // Resolve subject: plain string or TemplateRenderNode with optional parent
        const resolveSubject = (node: string | TemplateRenderNode): string => {
            if (typeof node === 'string') return node;

            const childSubject = resolveSource(node, dir);
            if (!node.parent) return childSubject;

            const parentTpl = this.loadTemplate(node.parent);
            return parentTpl.subject.replace('{{subject}}', childSubject);
        };

        // Resolve a TemplateRenderNode: may have a parent for recursive wrapping.
        // Child <style> blocks are extracted and injected before </style> in the parent.
        // Returns { render, subject } — the subject may change if the parent has its own subject template.
        const resolveRender = (node: TemplateRenderNode, childSubject: string, childAlt: string): { render: string; subject: string } => {
            let childRender = resolveSource(node, dir);
            if (!node.parent)
                return { render: childRender, subject: childSubject };

            // Extract <style> blocks from the child so they can be merged into the parent's <style>
            const childStyles: string[] = [];
            childRender = childRender.replace(/<style>([\s\S]*?)<\/style>/gi, (_, css) => {
                childStyles.push(css.trim());
                return '';
            });

            const parentTpl = this.loadTemplate(node.parent);
            // resolvedSubject = parent subject template with {{subject}} replaced (for the final EmailTemplate.subject)
            const resolvedSubject = parentTpl.subject.replace('{{subject}}', childSubject);
            // In the render, use childSubject directly — the parent's {{serverName}} etc will be filled later by sendTemplatedEmail
            let parentHtml = parentTpl.render
                .replace(/\{\{subject\}\}/g, childSubject)
                .replace('{{render}}', childRender.trim())
                .replace('{{alt}}', childAlt);

            // Inject child styles just before </style> in the parent
            if (childStyles.length > 0) 
                parentHtml = parentHtml.replace('</style>', `\n${childStyles.join('\n\n')}\n    </style>`);

            return { render: parentHtml, subject: resolvedSubject };
        };

        // Resolve alt first (without parent — alt uses TemplateSource, not TemplateRenderNode)
        const childAlt = index.alt ? resolveSource(index.alt, dir) : '';

        // Resolve subject (may recurse through parent chain)
        const subject = resolveSubject(index.subject);

        // Resolve render (may recurse through parent chain — may also update subject)
        const { render: renderHtml, subject: finalSubject } = resolveRender(index.render, subject, childAlt);

        return { subject: finalSubject, render: renderHtml, alt: childAlt || undefined };
    }

    private render(template: string, vars: Record<string, string>): string {
        return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
    }

    async sendTemplatedEmail(
        to: string,
        templateName: string,
        variables: Record<string, string>,
        subjectOverride?: string,
    ): Promise<boolean> {
        if (!this.isAvailable()) {
            this.logger.warn(`Email not available — skipping ${templateName} to ${to}`);
            return false;
        }

        const tpl = this.loadTemplate(templateName);
        if (!tpl) {
            this.logger.error(`Template "${templateName}" not found`);
            return false;
        }

        const html = this.render(tpl.render, variables);
        const text = tpl.alt ? this.render(tpl.alt, variables) : undefined;
        const subject = subjectOverride || this.render(tpl.subject, variables);

        try {
            await this.transporter!.sendMail({
                from: await this.getFrom(),
                to,
                subject,
                html,
                text,
            });
            this.logger.log(`Email sent: ${templateName} → ${to}`);
            return true;
        } catch (err) {
            this.logger.error(`Failed to send ${templateName} to ${to}: ${(err as Error).message}`);
            return false;
        }
    }

    /**
     * Resolve instance.name which may be a plain string or a locale map
     * (e.g. `{"en":"Dev's Nox","fr":"Nox de Dev"}`).
     * Returns the first entry value if it's an object, or the string as-is.
     */
    async resolveInstanceName(): Promise<string> {
        const raw = await this.config.get<string | Record<string, string>>('instance.name');
        const parsed = parseLocalizedString(raw);
        if (typeof parsed === 'object') {
            const first = Object.values(parsed)[0];
            return first || 'Nox';
        }
        return parsed || 'Nox';
    }

    private async getFrom(): Promise<string> {
        const fromName = await this.config.get<string>('email.from_name');
        const fromAddr = await this.config.get<string>('email.from');
        const user = await this.config.get<string>('email.user');
        const instanceName = await this.resolveInstanceName();
        const name = fromName || instanceName;
        const addr = fromAddr || user;
        return `${name} <${addr}>`;
    }
}
