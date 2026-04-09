import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiUserDto } from './user-response.dto';

export class UserSearchResponseDto {
    @ApiProperty({ description: 'Total number of users matching the query', example: 100 })
    total!: number;

    @ApiPropertyOptional({ type: 'string', description: 'Free-text search query that was applied', example: 'john', nullable: true })
    query!: string | null;

    @ApiProperty({ type: [String], description: 'List of NoxIdentifier strings queried by ID (empty if text search was used)', example: [] })
    ids!: string[];

    @ApiProperty({ description: 'Page size', example: 10 })
    limit!: number;

    @ApiProperty({ description: 'Page offset', example: 0 })
    offset!: number;

    @ApiProperty({ type: () => [ApiUserDto], description: 'Matching users' })
    items!: ApiUserDto[];
}
