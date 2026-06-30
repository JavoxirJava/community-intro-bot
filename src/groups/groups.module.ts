import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GroupsService } from './groups.service';

@Module({
  imports: [UsersModule],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
