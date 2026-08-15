const { DashboardService } = require('../services/dashboardService');

class DashboardController {
  constructor() {
    this.dashboardService = new DashboardService();
  }

  async summary() {
    const summary = await this.dashboardService.getDashboardSummary();
    return { data: summary, ok: true };
  }
}

module.exports = { DashboardController };
