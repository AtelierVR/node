import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { ApiErrorDetailsDto } from '../src/api/dto/error-details.dto';
import { writeFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

console.log('Generating OpenAPI specification...');

// Minimal stub — onModuleInit is intentionally absent so NestJS never tries to
// connect to a database or run migrations during spec generation.
const prismaStub: Partial<PrismaService> = {
    ready: Promise.resolve(),
    configs: {
        findFirst: () => Promise.resolve(null),
    } as any,
};

(async function generate() {
    console.log('Building module context...');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prismaStub)
        .compile();

    const app = moduleRef.createNestApplication({ logger: false });

    app.setGlobalPrefix('api');

    const config = new DocumentBuilder()
        .setTitle('NOX API')
        .setDescription('NOX REST API')
        .setVersion('1.0')
        .addSecurity('bearer', {
            type: 'apiKey',
            in: 'header',
            name: 'Authorization',
            'x-auth-scheme': 'Bearer',
            'x-token-format': 'token',
            description: 'User session token. Obtained from POST /api/auth/login.'
        })
        .addSecurity('nox-challenge', {
            type: 'apiKey',
            in: 'header',
            name: 'Authorization',
            'x-auth-scheme': 'Challenge',
            'x-token-format': '<keyId_b64url>.<data_b64url>.<sig_b64url>',
            description: 'Nox server-to-server challenge token. The payload is RSA-OAEP encrypted with the target server\'s public key and RSA-SHA256 signed with the sending server\'s private key.',
        })
        .addSecurity('nox-as', {
            type: 'apiKey',
            in: 'header',
            name: 'X-Nox-As',
            'x-token-format': 'number',
            description: 'Internal user identifier of the federated user on whose behalf the remote server is acting. Only meaningful alongside a valid `nox-challenge` token.',
        })
        .build();

    const document = SwaggerModule.createDocument(app, config, {
        extraModels: [ApiErrorDetailsDto],
    });

    // Post-process: add {} (no-auth alternative) for endpoints with optional security.
    for (const pathItem of Object.values(document.paths ?? {})) {
        for (const [method, op] of Object.entries(pathItem as Record<string, any>)) {
            if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)
                && op?.['x-auth-optional'] && Array.isArray(op.security)) {
                op.security.push({});
                delete op['x-auth-optional'];
            }
        }
    }

    const outputPath = join(process.cwd(), '_openapi.yaml');
    writeFileSync(outputPath, yaml.dump(document, { noRefs: true }));
    console.log(`OpenAPI spec written to ${outputPath}`);

    await app.close();
})();