# 星研数据库结构

数据库`star-study`，Dexie/IndexedDB，当前v3。实体在`src/types/index.ts`，索引和迁移在`src/db/index.ts`。主键均为稳定UUID，记录createdAt和updatedAt。

| 表                | 内容和索引                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| userProfiles      | 本科信息、毕业时间、称呼                                                                                          |
| examTargets       | 目标与备选院校、专业；examDate                                                                                    |
| subjects          | 科目名称、category、priority、active                                                                              |
| knowledgePoints   | 科目、章节、parentId、dependencyIds、五级掌握度、评估history、归档                                                |
| resources         | 科目、章节、老师/URL/集数/教材/练习、核实状态、进度、掌握度、知识点、归档                                         |
| tasks             | 日期、科目、状态、sourceKey、deletedAt、[date+subjectId]、知识点数组、dueDate、scheduleKey、mistakeId、originDate |
| taskResources     | taskId/resourceId关联；事务内防重复                                                                               |
| sessions          | taskId、state、时间戳片段segments                                                                                 |
| mistakes          | 科目、章节、答案、原因、解析、知识点和任务关联、reviewDate、mastery、归档、Blob[]图片                             |
| mistakeReviews    | mistakeId、reviewedAt、mastery和笔记                                                                              |
| weeklyReviews     | 唯一weekStart、困难、学校考试、下周7天预算、优先科目、建议、保存时统计快照                                        |
| revisions         | 唯一revisionId、planVersion、前后快照、变化、原因、确认时间、操作类型、恢复目标、可选预算快照                     |
| settings          | 唯一key；预算、主题、提醒、目标变化核对提示等                                                                     |
| recoverySnapshots | 恢复前完整JSON；独立安全表，不递归打进核心备份                                                                    |

v1建立13类核心实体，v2增加软删除索引与恢复前快照，v3增加任务排期/关联索引，错题和知识点章节/归档索引，并补齐旧行的可选字段。升级不清库，不删除图片或旧科目。已有v1/v2升级和Blob字节保留测试。

五级掌握：unlearned未学习、unmastered未掌握、weak薄弱、basic基本掌握、proficient熟练掌握。打卡不会自动升级掌握度；用户复习时主动选择是否同步到知识点。

任务状态todo/in_progress/partial/completed/skipped。计时独立于任务，segments使用毫秒时间戳，暂停/结束封闭时间段，恢复新建下一段。多标签页只能有一条未结束计时。统计按实际本地日期切分跨午夜片段，不根据任务当前日期重复累计。

任务originDate记录首次安排日期；estimatedMinutes是预计总量，plannedMinutes为当前日期排期量；unscheduled内容保留但不伪占每日预算。拆分用parentTaskId关联；不会通过拆分伪造学习记录。

归档/删除采用保留方式。完成任务的计划字段受保护。科目切换停用旧科目、启用或新增新科目，旧任务、计时、知识点与版本保持原ID。首次初始化只写个人目标、四科和默认预算，不写演示学习记录。

完整备份校验结构、版本、UUID、日期、时长、枚举、URL、计时顺序及核心关联，拒绝知识点循环。图片在库内为Blob，导出为MIME+Base64；恢复前校验与替换事务分离，写入失败整库回滚。
