import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiTableEntryDto {
    @ApiProperty({ description: 'Entry key', example: 'my-key' })
    key!: string;

    @ApiProperty({ description: 'MIME type of the stored value', example: 'application/json' })
    mime!: string;

    @ApiProperty({ description: 'Size of the stored value in bytes', example: 128 })
    size!: number;

    @ApiProperty({ description: 'ISO 8601 creation timestamp', example: '2024-01-01T00:00:00.000Z' })
    created_at!: string;

    @ApiProperty({ description: 'ISO 8601 last-updated timestamp', example: '2024-06-01T00:00:00.000Z' })
    updated_at!: string;
}

export class TableListDataDto {
    @ApiProperty({ type: () => [ApiTableEntryDto], description: 'Table entries' })
    tables!: ApiTableEntryDto[];

    @ApiProperty({ description: 'Page size', example: 10 })
    limit!: number;

    @ApiProperty({ description: 'Page offset', example: 0 })
    offset!: number;

    @ApiProperty({ description: 'Total number of entries for this user', example: 42 })
    total!: number;
}

export class PublicTableDto {
    @ApiProperty({ description: 'Table key', example: 'username' })
    key!: string;

    @ApiPropertyOptional({ description: 'Stored value (JSON or binary encoded as base64)', example: { name: 'John' }, nullable: true })
    value!: unknown;

    @ApiProperty({ description: 'Unix timestamp (ms) of last update', example: 1680000000000 })
    updated_at!: number;
}

export class TableDeleteResponseDto {
    @ApiProperty({ description: 'Whether the deletion was successful', example: true })
    success!: boolean;

    @ApiProperty({ description: 'The key that was deleted', example: 'my-key' })
    key!: string;
}
