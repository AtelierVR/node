import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNoxIdentifier } from '../common/validation';

export interface ApiActivityEvent {
    id: number;
    type: string;
    message: string;
    details: unknown | null;
    /** NoxIdentifier string of the author, or null for system events */
    author: string | null;
    created_at: string;
}

export class CreateActivityEventDto {
    @ApiProperty({ example: 'user.registered', description: 'Event type identifier' })
    @MaxLength(128)
    @Matches(/^[a-z0-9_.-]+$/, { message: 'type must be lowercase alphanumeric with . _ -' })
    @IsString()
    @IsNotEmpty()
    type!: string;

    @ApiProperty({ example: 'A new user registered.' })
    @MaxLength(2048)
    @IsString()
    @IsNotEmpty()
    message!: string;

    @ApiPropertyOptional({ example: { userId: 42 }, nullable: true, description: 'Optional structured details' })
    @IsOptional()
    details?: unknown;

    @ApiPropertyOptional({ type: 'string', example: 'u:1@my-server.com', nullable: true, description: 'NoxIdentifier string of the author. Omit for system events.' })
    @IsOptional()
    @IsNoxIdentifier()
    author?: string;
}
