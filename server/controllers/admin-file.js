"use strict";

const { merge } = require("lodash/fp");
const { mapAsync } = require("@strapi/utils");
const { getService } = require("../utils");
const { ACTIONS, FILE_MODEL_UID } = require("../constants");
const {
  findEntityAndCheckPermissions,
} = require("./utils/find-entity-and-check-permissions");

module.exports = {
  async find(ctx) {
    const {
      state: { userAbility },
    } = ctx;

    const userIds = await strapi.db.connection
      .raw(
        `
      SELECT DISTINCT
        caul.user_id
      FROM
        companies_admin_users_links caul
      JOIN (
        SELECT
          user_id, company_id
        FROM
          companies_admin_users_links
        WHERE
          user_id = ${ctx.state.user.id}
      ) AS user_companies ON
        caul.company_id = user_companies.company_id
    `
      )
      .then((res) => res.rows.map((row) => row.user_id));

    const defaultQuery = {
      populate: {
        folder: true,
        createdBy: true,
      },
    };

    const pm = strapi.admin.services.permission.createPermissionsManager({
      ability: userAbility,
      action: ACTIONS.read,
      model: FILE_MODEL_UID,
    });

    if (!pm.isAllowed) {
      return ctx.forbidden();
    }

    const pmQuery = pm.addPermissionsQueryTo(merge(defaultQuery, ctx.query));
    const query = await pm.sanitizeQuery(pmQuery);

    query.filters["$and"]?.push({
      createdBy: {
        id: {
          $in: userIds,
        },
      },
    });

    const { results: files, pagination } = await getService("upload").findPage(
      query
    );

    // Sign file urls for private providers
    const signedFiles = await mapAsync(files, getService("file").signFileUrls);

    const sanitizedFiles = await pm.sanitizeOutput(signedFiles);

    return { results: sanitizedFiles, pagination };
  },

  async findOne(ctx) {
    const {
      state: { userAbility },
      params: { id },
    } = ctx;

    const { pm, file } = await findEntityAndCheckPermissions(
      userAbility,
      ACTIONS.read,
      FILE_MODEL_UID,
      id
    );

    const signedFile = await getService("file").signFileUrls(file);
    ctx.body = await pm.sanitizeOutput(signedFile);
  },

  async destroy(ctx) {
    const { id } = ctx.params;
    const { userAbility } = ctx.state;

    const { pm, file } = await findEntityAndCheckPermissions(
      userAbility,
      ACTIONS.update,
      FILE_MODEL_UID,
      id
    );

    const [body] = await Promise.all([
      pm.sanitizeOutput(file, { action: ACTIONS.read }),
      getService("upload").remove(file),
    ]);

    ctx.body = body;
  },
};
