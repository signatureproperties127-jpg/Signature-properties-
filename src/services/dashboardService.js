const { ApiService } = require('../api/api');

class DashboardService {
  async getDashboardSummary() {
    return ApiService.dashboard.getSummary();
  }
}

module.exports = { DashboardService };
