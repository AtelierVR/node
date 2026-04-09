import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorDetailsDto {
    @ApiProperty({ type: 'string', description: 'Upper-snake-case error code', example: 'NOT_FOUND' })
    code!: string;

    @ApiProperty({ type: 'string', description: 'Human-readable error description', example: 'Resource not found.' })
    message!: string;

    @ApiProperty({ type: 'integer', description: 'HTTP status code', example: 404 })
    status!: number;
}
