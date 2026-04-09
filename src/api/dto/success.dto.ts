import { ApiProperty } from '@nestjs/swagger';

export class ApiSuccessDto {
    @ApiProperty({ description: 'Whether the operation succeeded', example: true })
    success!: boolean;
}
