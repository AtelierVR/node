import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
    @IsString()
    @IsNotEmpty()
    type!: string;

    @ApiProperty({ example: 'A new user registered.' })
    @IsString()
    @IsNotEmpty()
    message!: string;

    @ApiPropertyOptional({ example: { userId: 42 }, nullable: true, description: 'Optional structured details' })
    @IsOptional()
    details?: unknown;

    @ApiPropertyOptional({ type: 'string', example: 'u:1@my-server.com', nullable: true, description: 'NoxIdentifier string of the author. Omit for system events.' })
    @IsOptional()
    @IsString()
    author?: string;
}
