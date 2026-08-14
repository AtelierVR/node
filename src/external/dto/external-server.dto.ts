import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NoxWellKnownDto } from '../../fediverse/dto/nox-well-known.dto';

export class ExternalServerBaseDto {
    @ApiProperty({ description: 'Domain address of the external server', example: 'example.com' })
    address!: string;

    @ApiProperty({ description: 'Trust rank (higher = more trusted)', example: 0 })
    rank!: number;

    @ApiProperty({ description: 'Unix timestamp (ms) of last seen contact', example: 1680000000000 })
    last_seen!: number;

    @ApiProperty({ description: 'Unix timestamp (ms) of first discovery', example: 1680000000000 })
    created_at!: number;
}

export class ExternalServerListItemDto extends ExternalServerBaseDto {
    @ApiPropertyOptional({ type: () => NoxWellKnownDto, description: 'Well-known document, or null if unreachable', nullable: true })
    well_known!: NoxWellKnownDto | null;
}
