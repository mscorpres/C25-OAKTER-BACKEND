// middleware/poPermission.js
const fs = require('fs');
const path = require('path');

class POPermissionManager {
  constructor() {
    this.permissionsPath = path.join(__dirname, '../config/Permission.json');
    this.permissions = null;
    this.loadPermissions();
  }

  loadPermissions() {
    try {
      const data = fs.readFileSync(this.permissionsPath, 'utf8');
      this.permissions = JSON.parse(data);
      console.log('Permissions loaded successfully');
    } catch (error) {
      console.error(' Error loading permissions:', error);
      this.permissions = { teams: [] };
    }
  }

  reloadPermissions() {
    this.loadPermissions();
  }

  findUserInTeams(userId) {
    if (!this.permissions || !this.permissions.teams) {
      return null;
    }

    for (const team of this.permissions.teams) {
      
      if (team.leader && team.leader.user_id === userId) {
        return {
          team_id: team.team_id,
          team_name: team.team_name,
          role: 'leader',
          permissions: team.leader,
          team_cost_centers: team.team_cost_centers || [],
          user_cost_centers: team.team_cost_centers || [] 
        };
      }

   
      if (team.members) {
        const member = team.members.find(m => m.user_id === userId);
        if (member) {
          return {
            team_id: team.team_id,
            team_name: team.team_name,
            role: 'members',
            permissions: member,
            team_cost_centers: team.team_cost_centers || [],
            user_cost_centers: member.cost_centers || [] 
          };
        }
      }
    }

    return null;
  }

  hasCostCenterAccess(userInfo, costCenter) {
    if (!userInfo || !costCenter) return false;
    return userInfo.user_cost_centers.includes(costCenter);
  }

  getAllowedCostCenters(userId) {
    const userInfo = this.findUserInTeams(userId);
    if (!userInfo) return [];
    return userInfo.user_cost_centers;
  }

 
  async checkPermission(action, userId, additionalData = {}) {
    const userInfo = this.findUserInTeams(userId);
    
    
    if (!userInfo) {
      return { 
        allowed: false, 
        reason: 'User not found in any PO team. Please contact administrator.',
        userInfo: null 
      };
    }

    
    if (action === 'edit') {
      
      const hasEditOwnPo = userInfo.permissions.can_edit_own_po;
      const hasEditTeamPo = userInfo.permissions.can_edit_team_po;
      
      if (!hasEditOwnPo && !hasEditTeamPo) {
        return { 
          allowed: false, 
          reason: `User does not have permission to edit PO in team ${userInfo.team_name}`,
          userInfo 
        };
      }
      
      
      return await this.checkEditPermission(userInfo, userId, additionalData);
    }

    
    if (action === 'approve') {
      const hasFirstLevel = userInfo.permissions.can_approve_po_first_level === true;
      const hasFinalLevel = userInfo.permissions.can_approve_po_final_level === true;
      
      if (!hasFirstLevel && !hasFinalLevel) {
        return { 
          allowed: false, 
          reason: `User does not have permission to approve PO in team`,
          userInfo 
        };
      }
      
      
      return this.checkCostCenterPermission(userInfo, additionalData);
    }

    
    const permissionKey = `can_${action}_po`;
    
    if (userInfo.permissions[permissionKey] === undefined) {
      return { 
        allowed: false, 
        reason: `Permission '${permissionKey}' not defined in JSON for user`,
        userInfo 
      };
    }

    if (!userInfo.permissions[permissionKey]) {
      return { 
        allowed: false, 
        reason: `User does not have permission to ${action} PO in team ${userInfo.team_name}`,
        userInfo 
      };
    }

    
    if (action === 'create') {
      return this.checkCostCenterPermission(userInfo, additionalData);
    }

    return { allowed: true, userInfo };
  }

 
  async checkEditPermission(userInfo, userId, additionalData) {
    const { costCenter, invtDB, branch, poId } = additionalData;
    
    if (!poId) {
      return { allowed: false, reason: 'PO ID is required', userInfo };
    }

    if (!invtDB) {
      return { allowed: false, reason: 'Database connection not provided', userInfo };
    }

    try {
      
      const poData = await invtDB.query(
        'SELECT po_insert_by, po_cost_center FROM po_purchase_req WHERE po_transaction = :poid AND company_branch = :branch LIMIT 1',
        {
          replacements: { poid: poId, branch },
          type: invtDB.QueryTypes.SELECT
        }
      );

      if (poData.length === 0) {
        return { allowed: false, reason: 'PO not found', userInfo };
      }

      const poCreatorId = poData[0].po_insert_by;
      const poCostCenter = costCenter || poData[0].po_cost_center;

      console.log(` Edit Check: User=${userId}, Creator=${poCreatorId}, Role=${userInfo.role}, CostCenter=${poCostCenter}`);

      // Check cost center access
      if (!this.hasCostCenterAccess(userInfo, poCostCenter)) {
        return { 
          allowed: false, 
          reason: `User does not have access to cost center: ${poCostCenter}`,
          userInfo 
        };
      }

    
      if (userInfo.role === 'leader') {
        
        if (userInfo.permissions.can_edit_team_po) {
          return { allowed: true, userInfo };
        }
        
       
        if (userInfo.permissions.can_edit_own_po && userId === poCreatorId) {
          return { allowed: true, userInfo };
        }
        
        return { 
          allowed: false, 
          reason: 'Leader can only edit own POs (can_edit_team_po is disabled)',
          userInfo 
        };
      }

      // Member permissions
      if (userInfo.role === 'members') {
       
        if (userInfo.permissions.can_edit_team_po) {
          console.log('✅ Member with can_edit_team_po - Edit allowed');
          return { allowed: true, userInfo };
        }
        
       
        if (userInfo.permissions.can_edit_own_po && userId === poCreatorId) {
          return { allowed: true, userInfo };
        }
        
        console.log(` Member cannot edit: Creator=${poCreatorId}, CurrentUser=${userId}`);
        return { 
          allowed: false, 
          reason: 'You can only edit your own POs',
          userInfo 
        };
      }

      return { allowed: false, reason: 'Invalid role', userInfo };

    } catch (error) {
      return { 
        allowed: false, 
        reason: 'Error checking PO details: ' + error.message,
        userInfo 
      };
    }
  }

  // Cost center permission check
  checkCostCenterPermission(userInfo, additionalData) {
    const { costCenter } = additionalData;
    
    if (costCenter && !this.hasCostCenterAccess(userInfo, costCenter)) {
      return { 
        allowed: false, 
        reason: `User does not have access to cost center: ${costCenter}`,
        userInfo 
      };
    }

    return { allowed: true, userInfo };
  }
}

// Singleton instance
const permissionManager = new POPermissionManager();

// SINGLE MIDDLEWARE FOR ALL ACTIONS
const checkPOPermission = (action) => {
  return async (req, res, next) => {
    const userId = req.logedINUser;
    const costCenter = req.body.pocostcenter || req.body.costcenter;
    const poId = req.body.poid || req.body.pono || req.body.po_id || req.body.po_transaction;

    if (!userId) {
      return res.json({
        code: 401,
        status: 'error',
        message : {msg: 'User not authenticated' }
      });
    }

    try {
      const result = await permissionManager.checkPermission(action, userId, {
        poId,
        costCenter,
        invtDB: require('../config/db/connection').invtDB,
        branch: req.branch
      });

      if (!result.allowed) {
        return res.json({
          code: 403,
          status: 'error',
          message:{msg: result.reason} 
        });
      }

      // Attach user permission info to request
      req.userPermissions = result.userInfo;
      next();

    } catch (error) {
      console.error('Error in checkPOPermission middleware:', error);
      return res.json({
        code: 500,
        status: 'error',
        message: 'Error checking permissions',
        error: error.message
      });
    }
  };
};

module.exports = {
  permissionManager,
  checkPOPermission
};