/**
 * Operation Repository for managing operations
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';

class OperationRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.OPERATIONS);
  }
}

export const operationRepository = new OperationRepositoryClass();
