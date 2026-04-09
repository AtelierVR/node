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
