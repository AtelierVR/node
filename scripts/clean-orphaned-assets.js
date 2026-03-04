#!/usr/bin/env node
/**
 * Utility script to clean orphaned avatar asset files
 * Usage: node scripts/clean-orphaned-assets.js
 */

import Reileta from '../src/Main';

async function main() {
    console.log('🧹 Starting orphaned asset files cleanup...\n');
    
    const app = new Reileta();
    await app.start();

    try {
        const result = await app.avatars.cleanOrphanedFiles();
        
        console.log('\n📊 Cleanup Results:');
        console.log(`   ✅ Deleted: ${result.deleted} files`);
        console.log(`   ⏭️  Skipped: ${result.skipped} files (still referenced)`);
        console.log(`   ❌ Errors: ${result.errors} files`);
        
        if (result.deleted > 0) {
            console.log('\n✨ Cleanup completed successfully!');
        } else {
            console.log('\n✨ No orphaned files found.');
        }
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        process.exit(1);
    } finally {
        await app.stop();
        process.exit(0);
    }
}

main().catch(console.error);
