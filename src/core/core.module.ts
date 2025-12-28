import { Global, Module } from '@nestjs/common';
import { AppLogger } from './logger/app.logger';
import { ContextService } from './context/context.service';

@Global()
@Module({
  providers: [
    ContextService,
    {
      provide: AppLogger,
      useFactory: (contextService: ContextService) => {
        return new AppLogger('App', contextService);
      },
      inject: [ContextService],
    },
  ],
  exports: [ContextService, AppLogger],
})
export class CoreModule {}
