import { ApiProperty } from '@nestjs/swagger';

export class ApiAliasDto {
    @ApiProperty({ description: 'Alias key name', example: 'iid' })
    key!: string;

    @ApiProperty({ description: 'Alias value (NoxIdentifier or string)', example: '1@my-server.com' })
    value!: string;
}

export class ApiLinkResponseDto {
    @ApiProperty({ description: 'Link display label', example: 'GitHub' })
    label!: string;

    @ApiProperty({ description: 'Link URL', example: 'https://github.com/johndoe' })
    value!: string;
}

export class ReleaseInfoDto {
    @ApiProperty({ description: 'Actual version number. -1 = none available.', example: 2 })
    value!: number;

    @ApiProperty({ description: 'Whether the release was auto-detected (latest available).', example: false })
    auto!: boolean;
}
