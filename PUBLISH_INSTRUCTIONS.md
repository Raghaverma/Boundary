# Publish Instructions - v2.0.0

## Pre-Publish Checklist

✅ Build successful (`npm run build`)  
✅ All tests pass (`npm test`)  
✅ Version set to `2.0.0` in `package.json`  
✅ CHANGELOG.md updated with v2.0.0  
✅ README.md has deprecation banner  
✅ RELEASE_NOTES_v2.0.0.md created  
✅ Contract locked (CONTRACT_LOCK.md)

## Step 1: Deprecate Unsafe Versions

**Run this command BEFORE publishing v2.0.0:**

```bash
npm deprecate boundary-sdk@"<2.0.0" "Deprecated: unsafe defaults. Upgrade to >=2.0.0 for production use."
```

This will:
- Mark all versions <2.0.0 as deprecated
- Show deprecation warning to users installing old versions
- Encourage migration to v2.0.0

**Note:** You must be logged in as the package owner:
```bash
npm login
```

## Step 2: Publish v2.0.0

```bash
npm publish
```

This will:
- Publish as `boundary-sdk@2.0.0`
- Become the `latest` tag (unless you use `--tag`)
- Make v2.0.0 the default for new installs

## Step 3: Create GitHub Release

1. **Create release on GitHub:**
   - Go to: https://github.com/Raghaverma/Boundary/releases/new
   - Tag: `v2.0.0`
   - Title: `v2.0.0 - Safe-by-Default Contract Established`
   - Description: Copy contents from `RELEASE_NOTES_v2.0.0.md`

2. **Or use GitHub CLI:**
   ```bash
   gh release create v2.0.0 \
     --title "v2.0.0 - Safe-by-Default Contract Established" \
     --notes-file RELEASE_NOTES_v2.0.0.md
   ```

3. **Tag the commit (if not already tagged):**
   ```bash
   git tag v2.0.0
   git push origin v2.0.0
   ```

## Step 4: Verify

After publishing, verify:

1. **npm registry:**
   ```bash
   npm view boundary-sdk versions
   npm view boundary-sdk@2.0.0
   ```

2. **Deprecation status:**
   ```bash
   npm view boundary-sdk@1.0.2 deprecated
   # Should show: "Deprecated: unsafe defaults. Upgrade to >=2.0.0 for production use."
   ```

3. **GitHub release exists:**
   - Visit: https://github.com/Raghaverma/Boundary/releases
   - Verify v2.0.0 release is visible

## Post-Publish

After successful publish:

1. ✅ Monitor for issues
2. ✅ Respond to migration questions
3. ✅ Update any external documentation
4. ✅ Celebrate - you've shipped a production-grade SDK! 🎉

## Important Notes

- **Do NOT** weaken defaults in future releases
- **Do NOT** reintroduce optional initialization
- **Do NOT** add convenience shortcuts that bypass safety
- **DO** preserve the locked contract in all future releases

The contract is locked. The SDK is shipped. The release is legitimate.
