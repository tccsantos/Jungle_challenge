import { defineConfig } from '@mikro-orm/postgresql';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
export default defineConfig({
    clientUrl: process.env.DATABASE_URL ??
        'postgresql://wagering:wagering_dev@db:5432/wagering_processor',
    entities: ['./dist/**/*.entity.js'],
    entitiesTs: ['./src/**/*.entity.ts'],
    metadataProvider: ReflectMetadataProvider,
    extensions: [Migrator],
    migrations: {
        path: './dist/migrations',
        pathTs: './migrations',
        glob: '!(*.d).{js,ts}',
        transactional: true,
        allOrNothing: true,
        emit: 'ts',
    },
    debug: process.env.NODE_ENV !== 'production',
});
//# sourceMappingURL=mikro-orm.config.js.map