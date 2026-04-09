import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiActivityEventResponseDto {
    @ApiProperty({ description: 'Internal numeric event ID', example: 1 })
    id!: number;

    @ApiProperty({ description: 'Dot-namespaced event type (e.g. user.registered)', example: 'user.registered' })
    type!: string;

    @ApiProperty({ description: 'Human-readable event message', example: 'A new user registered.' })
    message!: string;

    @ApiPropertyOptional({ description: 'Optional structured event details, or null', example: null, nullable: true })
    details!: unknown | null;

    @ApiPropertyOptional({ type: 'string', description: 'NoxIdentifier of the user who triggered the event, or null', example: 'u:1@my-server.com', nullable: true })
    author!: string | null;

    @ApiProperty({ description: 'ISO 8601 timestamp of when the event occurred', example: '2024-01-01T00:00:00.000Z' })
    created_at!: string;
}
