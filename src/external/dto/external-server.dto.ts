import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NoxWellKnownDto } from '../../fediverse/dto/nox-well-known.dto';

export class ExternalServerListItemDto {
    @ApiProperty({ description: 'Domain address of the external server', example: 'example.com' })
    address!: string;

    @ApiProperty({ description: 'Trust rank (higher = more trusted)', example: 0 })
    rank!: number;

    @ApiProperty({ description: 'Unix timestamp (ms) of last seen contact', example: 1680000000000 })
    last_seen!: number;

    @ApiProperty({ description: 'Unix timestamp (ms) of first discovery', example: 1680000000000 })
    created_at!: number;
}

export class ExternalServerDetailDto extends ExternalServerListItemDto {
    @ApiPropertyOptional({
        type: () => NoxWellKnownDto,
        nullable: true,
        description: 'Live well-known document for this server, or null if unreachable.',
    })
    well_known!: NoxWellKnownDto | null;
}
