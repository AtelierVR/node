import { ApiProperty } from '@nestjs/swagger';
import { Allow, IsNotEmpty, IsString } from 'class-validator';

/**
 * Body of a `POST /tunnel` request — a server-to-server RPC frame.
 *
 * `id` selects the `@OnTunnel(id)` method that handles the request; `data` is
 * handed to that handler as-is (possibly `null`).
 */
export class TunnelFrameDto {
  /** Handler id — resolved by the `@OnTunnel(id)` method on the receiving side. */
  @ApiProperty({
    description: 'Handler id resolved by the @OnTunnel(id) method',
    example: 'relation',
  })
  @IsString()
  @IsNotEmpty()
  id!: string;

  /** Request payload handed to the handler (`null` when there is none). */
  @ApiProperty({
    description: 'Arbitrary request payload handed to the handler',
    nullable: true,
    example: null,
  })
  @Allow()
  data!: any;
}
