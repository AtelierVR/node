import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { ApiAliasDto } from '../../api/dto/shared.dto';
import type { ApiInstanceLifecycle, InstanceGraceKind } from '../instance-lifecycle.types';

export class ApiInstancePlayerDto {
    @ApiPropertyOptional({ type: 'string', description: 'NoxIdentifier of the user, or null for anonymous', example: '1@my-server.com', nullable: true })
    user!: string | null;

    @ApiProperty({ description: 'Player display name', example: 'John Doe' })
    display!: string;
}

export class ApiInstanceConnectionDto {
    @ApiProperty({ description: 'Transport method (e.g. relay, direct)', example: 'relay' })
    method!: string;

    @ApiProperty({ description: 'Connection endpoint data (URL or address)', example: 'wss://relay.my-server.com' })
    data!: string;

    @ApiPropertyOptional({ type: 'string', description: 'ISO 3166-1 alpha-2 region code (lowercase) reported by the relay provider, or null', example: 'fr', nullable: true })
    region!: string | null;
}

export class ApiInstancePersistentLifecycleDto {
    @ApiProperty({ description: 'Discriminant', example: 'persistent', enum: ['persistent'] })
    type!: 'persistent';
}

export class ApiInstanceGraceLifecycleDto {
    @ApiProperty({ description: 'Discriminant', example: 'grace', enum: ['grace'] })
    type!: 'grace';

    @ApiProperty({ description: 'Reason for the grace period: "created" (the instance was just created), "assigned" (just assigned/moved to a relay) or "startup" (node restart). Clients map it to the translation key `admin.instance_grace_<key>`', enum: ['created', 'assigned', 'startup'], example: 'created' })
    key!: InstanceGraceKind;

    @ApiProperty({ description: 'When the grace period expires (epoch ms)', example: 1735689600000 })
    expires!: number;
}

export class ApiInstanceRemovalLifecycleDto {
    @ApiProperty({ description: 'Discriminant', example: 'removal', enum: ['removal'] })
    type!: 'removal';

    @ApiProperty({ description: 'Estimated time (epoch ms) at which the instance will be removed (idle timeout reached)', example: 1735689600000 })
    at!: number;
}

@ApiExtraModels(ApiInstancePersistentLifecycleDto, ApiInstanceGraceLifecycleDto, ApiInstanceRemovalLifecycleDto)
export class ApiInstanceDto {
    @ApiProperty({ description: 'Internal numeric instance ID', example: 1 })
    id!: number;

    @ApiProperty({ description: 'Slug name of the instance', example: 'my-instance' })
    name!: string;

    @ApiPropertyOptional({ type: 'string', description: 'Display title, or null', example: 'Chill Hangout', nullable: true })
    title!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Description, or null', example: 'A relaxed hangout', nullable: true })
    description!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'URL to instance thumbnail, or null', example: null, nullable: true })
    thumbnail!: string | null;

    @ApiProperty({ description: 'Maximum player count', example: 16 })
    capacity!: number;

    @ApiProperty({ description: 'Server hostname', example: 'my-server.com' })
    server!: string;

    @ApiProperty({ description: 'Owner NoxIdentifier (u: prefixed)', example: 'u:1@my-server.com' })
    owner!: string;

    @ApiProperty({ description: 'World NoxIdentifier', example: '1@my-server.com' })
    world!: string;

    @ApiProperty({ description: 'Instance tags', type: [String], example: [] })
    tags!: string[];

    @ApiPropertyOptional({ type: () => ApiInstanceConnectionDto, description: 'Connection info for the client, or null if not connectable', nullable: true })
    connection!: ApiInstanceConnectionDto | null;

    @ApiProperty({ description: 'Number of currently connected clients', example: 3 })
    count!: number;

    @ApiProperty({ description: 'List of players currently in the instance', type: () => [ApiInstancePlayerDto] })
    players!: ApiInstancePlayerDto[];

    @ApiProperty({ description: 'Aliases (NoxIdentifier extras)', type: () => [ApiAliasDto] })
    alias!: ApiAliasDto[];

    @ApiPropertyOptional({
        description: 'Cleanup state of the instance, or null when there is nothing to report (automatic cleanup disabled, instance persistent, or player count unknown — e.g. relay offline)',
        nullable: true,
        oneOf: [
            { $ref: getSchemaPath(ApiInstancePersistentLifecycleDto) },
            { $ref: getSchemaPath(ApiInstanceGraceLifecycleDto) },
            { $ref: getSchemaPath(ApiInstanceRemovalLifecycleDto) },
        ],
    })
    lifecycle!: ApiInstanceLifecycle | null;
}
