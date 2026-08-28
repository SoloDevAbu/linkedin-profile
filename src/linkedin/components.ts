export const PROFILE_COMPONENTS = {
  activity: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity',
  aboveActivity: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity',
  experience: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsExperienceOnly',
  below1: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1WithoutExp',
  below2: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart2',
  below3: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart3',
  below4: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart4',
  below5: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart5',
  below6: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart6',
  skills: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart7'
} as const;

export const DETAIL_DEFINITIONS = {
  experience: {
    route: 'experience',
    screenId: 'com.linkedin.sdui.flagshipnav.profile.ProfileExperienceDetails',
    pageKey: 'profile_view_base_experience_details',
    pagerId: 'com.linkedin.sdui.pagers.profile.details.experience'
  },
  education: {
    route: 'education',
    screenId: 'com.linkedin.sdui.flagshipnav.profile.ProfileEducationDetails',
    pageKey: 'profile_view_base_education_details',
    pagerId: 'com.linkedin.sdui.pagers.profile.details.education'
  },
  projects: {
    route: 'projects',
    screenId: 'com.linkedin.sdui.flagshipnav.profile.ProfileProjectDetails',
    pageKey: 'profile_view_base_projects_details',
    pagerId: 'com.linkedin.sdui.pagers.profile.details.projects'
  },
  skills: {
    route: 'skills',
    screenId: 'com.linkedin.sdui.flagshipnav.profile.ProfileSkillDetails',
    pageKey: 'profile_view_base_skills_details',
    pagerId: 'com.linkedin.sdui.pagers.profile.details.skills'
  },
  certifications: {
    route: 'certifications',
    screenId: 'com.linkedin.sdui.flagshipnav.profile.ProfileCertificationDetails',
    pageKey: 'profile_view_base_certifications_details',
    pagerId: 'com.linkedin.sdui.pagers.profile.details.certifications'
  },
  languages: {
    route: 'languages',
    screenId: 'com.linkedin.sdui.flagshipnav.profile.ProfileLanguageDetails',
    pageKey: 'profile_view_base_languages_details',
    pagerId: 'com.linkedin.sdui.pagers.profile.details.languages'
  }
} as const;

export type DetailSection = keyof typeof DETAIL_DEFINITIONS;
