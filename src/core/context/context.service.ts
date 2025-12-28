import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

type ContextStore = Map<string, any>;

@Injectable()
export class ContextService {
  private readonly storage = new AsyncLocalStorage<ContextStore>();

  run(fn: () => void, initialContext: Record<string, any> = {}) {
    const store = new Map(Object.entries(initialContext));
    this.storage.run(store, fn);
  }

  set(key: string, value: any) {
    this.storage.getStore()?.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.storage.getStore()?.get(key);
  }
}
