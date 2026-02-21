/**
 * Organization Repository for managing organizations
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';

class OrganizationRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.ORGANIZATIONS);
  }
}

export const organizationRepository = new OrganizationRepositoryClass();
