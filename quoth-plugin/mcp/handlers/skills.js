'use strict'

const path = require('path')

const TOOLS = [
  {
    name: 'quoth_extract_skill',
    description: 'Extract a reusable test skill from a passing test file using Sonnet 4.6',
    inputSchema: {
      type: 'object',
      properties: {
        testFile: { type: 'string', description: 'Path to the passing test file' },
        feature: { type: 'string', description: 'Feature name for context' }
      },
      required: ['testFile']
    }
  },
  {
    name: 'quoth_list_skills',
    description: 'List all extracted skills from the local pattern database',
    inputSchema: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' }
      }
    }
  }
]

async function handle(name, args, db) {
  switch (name) {
    case 'quoth_extract_skill': {
      const { extractSkill } = require(path.join(__dirname, '../../daemon/lib/skill-extract.js'))
      const skill = await extractSkill({
        testFile: args.testFile,
        feature: args.feature || path.basename(args.testFile, '.spec.ts')
      })
      if (!skill) return { error: 'Skill extraction failed — check test file exists and is readable' }
      const id = require('crypto').createHash('sha1').update(skill.name).digest('hex').slice(0, 12)
      db.upsertPattern({
        id: `skill-${id}`,
        name: skill.name,
        pattern_type: 'skill',
        condition: skill.description,
        action: skill.template,
        confidence: 0.85,
        tags: [...(skill.assertions || []), ...(skill.pageObjects || [])],
        source: 'skill-derived'
      })
      return { extracted: true, skill }
    }
    case 'quoth_list_skills': {
      const patterns = db.getTopPatterns(50, args.tags || [])
      const skills = patterns.filter(p => p.source === 'skill-derived' || p.pattern_type === 'skill')
      return { skills }
    }
    default:
      return null
  }
}

module.exports = { TOOLS, handle }
