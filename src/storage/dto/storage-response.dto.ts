import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiAssetJobStatusDto {
    @ApiProperty({ description: 'One of: empty, pending, processing, completed, failed', example: 'pending' })
    status!: string;

    @ApiPropertyOptional({ type: 'number', description: 'Processing progress (0–1), or null', example: 0.5, nullable: true })
    progress!: number | null;

    @ApiPropertyOptional({ type: 'string', description: 'Status message, or null', example: 'Processing…', nullable: true })
    message!: string | null;

    @ApiPropertyOptional({ type: 'number', description: 'Position in the processing queue, or null when not queued', example: 0, nullable: true })
    queue_position!: number | null;

    @ApiPropertyOptional({ type: 'string', description: 'SHA-256 file hash (only when completed), or null', example: null, nullable: true })
    hash!: string | null;

    @ApiPropertyOptional({ type: 'number', description: 'File size in bytes (only when completed), or null', example: null, nullable: true })
    size!: number | null;

    @ApiPropertyOptional({ type: 'string', description: 'ISO 8601 completion timestamp, or null', example: null, nullable: true })
    done_at!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Error message (only when failed), or null', example: null, nullable: true })
    error!: string | null;
}
