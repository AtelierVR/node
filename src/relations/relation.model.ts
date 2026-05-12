import { UserModel } from 'src/generated/prisma/models/User';
import { NoxIdentifier } from '../common/identifier';
import { UserRelationModel } from 'src/generated/prisma/models';
import { RelationsService } from './relations.service';
import { ApiRelation, ApiRelationType } from './relations.types';
import { $Enums, UserRelationType } from 'src/generated/prisma/client';
import { ApiException } from 'src/api/api-exception';
import { ApiErrorCode } from 'src/api/api-error.factory';

export type RelationWithMethods = UserRelationModel & {
    manager: RelationsService;
    initiator(): NoxIdentifier;
    target(): NoxIdentifier;
    sanitize(): Promise<ApiRelation>;
};

export const RELATION_TYPES: Record<UserRelationType, ApiRelationType> = {
    [UserRelationType.FOLLOW]: 'follow',
    [UserRelationType.REQUEST]: 'request'
}

export class Relation {
    // Attach methods to a plain UserModel instance and return it as UserWithMethods
    static attach(model: UserRelationModel, manager: RelationsService): RelationWithMethods {
        const obj = model as unknown as RelationWithMethods;
        Object.defineProperty(obj, 'manager', {
            value: manager,
            enumerable: false,
            configurable: true,
            writable: true,
        });

        // Ensure prototype methods are available
        Object.setPrototypeOf(obj, Relation.prototype as any);
        return obj;
    }

    initiator(this: RelationWithMethods): NoxIdentifier {
        return NoxIdentifier.parse(this.initiatorRef);
    }

    target(this: RelationWithMethods): NoxIdentifier {
        return NoxIdentifier.parse(this.targetRef);
    }

    // Note: `this` will be the underlying model after attach
    async sanitize(this: RelationWithMethods): Promise<ApiRelation> {
        let type = RELATION_TYPES[this.type] 
        if (!type) throw new ApiException(ApiErrorCode.INTERNAL_SERVER_ERROR, null, 'Unknown relation type');
        const address = await this.manager.wellKnown.address();
        return {
            id: this.id,
            type: type,
            initiator: this.initiator().toString(address),
            target: this.target().toString(address),
            created_at: this.createdAt.getTime()
        }
    }
}
