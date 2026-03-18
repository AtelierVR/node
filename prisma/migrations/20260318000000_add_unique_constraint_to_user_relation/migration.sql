-- AddUniqueConstraint
ALTER TABLE "user_relations" ADD CONSTRAINT "user_relations_initiator_ref_target_ref_key" UNIQUE ("initiator_ref", "target_ref");
